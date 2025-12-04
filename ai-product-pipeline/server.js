require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OSS = require('ali-oss');
const OpenAI = require('openai');
const axios = require('axios');
// 【替换】引入本地抠图库
const { removeBackground } = require('@imgly/background-removal-node');
// 【新增】轻量级PNG处理库（纯JS，无编译依赖）
const { PNG } = require('pngjs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// === 1. 客户端配置 ===

// A. 阿里云 OSS
const ossClient = new OSS({
    region: process.env.OSS_REGION,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    secure: true
});

// B. 阿里云 Qwen (文案)
const aliClient = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

// === 2. 核心工具函数 ===

// 上传到 OSS (添加public-read权限)
async function uploadToOSS(filePath, originalName) {
    try {
        const suffix = originalName.split('.').pop();
        const filename = `ai-upload/${Date.now()}_${Math.random().toString(36).slice(-5)}.${suffix}`;
        
        await ossClient.put(filename, filePath, {
            headers: {
                'x-oss-acl': 'public-read'
            }
        });
        
        let region = process.env.OSS_REGION;
        if (!region.startsWith('oss-')) region = `oss-${region}`;
        const url = `https://${process.env.OSS_BUCKET}.${region}.aliyuncs.com/${filename}`;
        
        console.log("✅ 原图OSS上传成功:", url);
        return url;
    } catch (e) {
        console.error("OSS 上传挂了:", e);
        throw new Error("图片上传 OSS 失败");
    }
}

// 【新增】在文件最顶部引入 sharp
const sharp = require('sharp'); 

// ... 其他引入 ...

/**
 * 【核弹级修复】本地抠图 -> 强制创建RGBA画布重绘 -> 上传 OSS
 * 解决 "Base image require RGBA format, but is P" 的终极方案
 */
async function processLocalSegmentationToOSS(localFilePath) {
    console.log(`[1/3] 正在进行本地智能抠图...`);
    
    try {
        // 1. 执行抠图
        const blob = await removeBackground(localFilePath);
        const arrayBuffer = await blob.arrayBuffer();
        const rawBuffer = Buffer.from(arrayBuffer);

        console.log(`    -> 抠图完成，正在标准化为 RGBA PNG...`);

        // 2. 【关键修复】直接处理为标准 RGBA PNG，不合成
        const rgbaBuffer = await sharp(rawBuffer)
            .ensureAlpha() // 确保有 Alpha 通道
            .png({
                palette: false,   // 禁用调色板（防止转成 P 模式）
                compressionLevel: 9,
                force: true
            })
            .toBuffer();

        console.log(`    -> 格式标准化成功，准备上传 OSS...`);

        // 3. 上传 OSS
        const filename = `ai-transparent/${Date.now()}_local_masked.png`;
        await ossClient.put(filename, rgbaBuffer, {
            headers: {
                'Content-Type': 'image/png',
                'x-oss-acl': 'public-read'
            }
        });

        let region = process.env.OSS_REGION;
        if (!region.startsWith('oss-')) region = `oss-${region}`;
        const finalUrl = `https://${process.env.OSS_BUCKET}.${region}.aliyuncs.com/${filename}`;

        console.log(`    -> ✅ 透明图已生成并存入OSS: ${finalUrl}`);
        
        // 可选：验证图片是否真透明（通过 head 请求不够，可下载检查前几个字节）
        return finalUrl;

    } catch (error) {
        console.error("❌ 图片处理失败:", error);
        throw new Error(`图片处理出错: ${error.message}`);
    }
}
// 辅助函数：获取颜色类型名称
function getColorTypeName(colorType) {
    const names = {
        0: "灰度",
        2: "RGB",
        3: "调色板(P)",
        4: "灰度+Alpha",
        6: "RGBA"
    };
    return names[colorType] || `未知 (${colorType})`;
}

/**
 * 【终极修复】阿里云万相：提交生图任务
 * 1. 添加详细错误诊断
 * 2. 增加重试机制
 */
async function submitWanxTask(transparentOssUrl, prompt, title) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    console.log(`[阿里云万相] 提交任务: ${title}...`);
    
    // 添加重试机制
    const MAX_RETRIES = 3;
    const INITIAL_DELAY = 3000; // 增加基础延迟
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`   -> 尝试提交 (第 ${attempt} 次)，使用图片: ${transparentOssUrl}`);
            
            // 【关键修复】添加图片预检
            console.log(`   -> 正在预检图片可访问性...`);
            const imgCheck = await axios.head(transparentOssUrl, { 
                timeout: 5000,
                validateStatus: function (status) {
                    return status >= 200 && status < 300;
                }
            });
            console.log(`   -> 图片预检成功 (状态码: ${imgCheck.status})`);
            
            const response = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/aigc/background-generation/generation',
                {
                    model: 'wanx-background-generation-v2',
                    input: {
                        base_image_url: transparentOssUrl,
                        ref_prompt: prompt
                    },
                    parameters: { n: 1 }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'X-DashScope-Async': 'enable',
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            return response.data.output.task_id;
        } catch (error) {
            const errData = error.response?.data || error;
            console.error(`万相提交失败 (尝试 ${attempt}/${MAX_RETRIES}):`, errData);
            
            // 详细错误诊断
            if (errData.code === 'InvalidParameter.DataInspection' || 
                errData.message?.includes('RGBA format')) {
                console.error(`❌ 严重错误：万相无法解码图片 ${transparentOssUrl}`);
                console.error(`   -> 请检查：1. 图片是否为RGBA格式 2. OSS权限是否正确`);
            }
            
            if (errData.code === 'Throttling.RateQuota' && attempt < MAX_RETRIES) {
                const delay = INITIAL_DELAY * Math.pow(2, attempt);
                console.log(`   -> 速率限制，等待 ${delay}ms 后重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            throw new Error(`生图提交失败: ${errData.message || error.message}`);
        }
    }
}

/**
 * 阿里云万相：轮询结果
 */
async function pollWanxResult(taskId) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const startTime = Date.now();
    
    while (true) {
        await new Promise(r => setTimeout(r, 2000));
        if (Date.now() - startTime > 90000) throw new Error("生图超时 (增加至90秒)"); // 增加超时时间

        const res = await axios.get(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000
        });

        const status = res.data.output.task_status;
        if (status === 'SUCCEEDED') return res.data.output.results[0].url;
        if (status === 'FAILED') throw new Error(`生图失败: ${res.data.output.message}`);
    }
}

// Qwen 策略分析 (保持不变)
async function analyzeAndGetStrategies(imageUrl, productName) {
    console.log(`正在分析商品: ${productName}...`);
    const response = await aliClient.chat.completions.create({
        model: "qwen-vl-max",
        messages: [
            {
                role: "system",
                content: `你是一个跨境电商策划专家。根据商品图片和名称，策划 3 组推广方案。
                要求返回纯 JSON: { "strategies": [ { "style": "...", "title": "...", "image_prompt": "..." }, ... ] }
                Prompt要求：只描述背景环境、光影、氛围，不要描述商品本身。`
            },
            {
                role: "user",
                content: [
                    { type: "text", text: `商品名: ${productName}` },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            }
        ],
        response_format: { type: "json_object" }
    });
    let content = response.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '');
    return JSON.parse(content).strategies;
}

// === 3. 主路由 ===

app.post('/api/generate', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;
    try {
        if (!filePath) return res.status(400).json({ error: '无文件' });
        const productName = req.body.productName || "Product";

        console.log("=== 任务启动 (RGBA终极修复版) ===");

        // 1. 上传原图到 OSS (为了给 Qwen 看)
        const originalUrlPromise = uploadToOSS(filePath, req.file.originalname);

        // 2. 本地执行抠图并上传 (为了给 万相 看)
        const transparentOssUrlPromise = processLocalSegmentationToOSS(filePath);

        // 并行处理：上传OSS、本地抠图、Qwen分析
        const originalUrl = await originalUrlPromise;
        
        console.log(">>> 正在并行执行：文案生成 & 抠图上传...");
        const [strategies, transparentOssUrl] = await Promise.all([
            analyzeAndGetStrategies(originalUrl, productName),
            transparentOssUrlPromise
        ]);

        console.log(">>> 素材准备就绪，开始万相生图...");

        // 3. 串行提交任务（避免并发限制）
        console.log(">>> 串行提交万相任务 (安全模式)...");
        const results = [];
        for (const strategy of strategies) {
            try {
                console.log(`   -> 正在生成: ${strategy.title}`);
                const taskId = await submitWanxTask(transparentOssUrl, strategy.image_prompt, strategy.title);
                const finalImageUrl = await pollWanxResult(taskId);
                
                results.push({
                    style: strategy.style,
                    title: strategy.title,
                    imageUrl: finalImageUrl
                });
                
                // 任务之间强制等待3秒（更安全）
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (err) {
                console.error(`   -> ❌ 风格 ${strategy.style} 失败:`, err.message);
                // 即使一个失败，继续尝试其他
                continue;
            }
        }

        if (results.length === 0) {
            throw new Error("所有风格生成均失败，请检查日志");
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, data: results });

    } catch (error) {
        console.error("🔥 处理失败:", error);
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: "请检查：1. 图片是否为RGBA格式 2. OSS权限是否为public-read 3. 网络是否可访问OSS"
        });
    }
});

const PORT = 3333;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`📌 重要提示：`);
    console.log(`   1. 确保OSS Bucket权限设置为"公共读"`);
    console.log(`   2. 确保跨域设置(CORS)允许万相服务访问`);
    console.log(`   3. 本版本已修复P模式转RGBA问题`);
});

// 添加辅助函数（确保在文件顶部可用）
function getColorTypeName(colorType) {
    const names = {
        0: "灰度",
        2: "RGB",
        3: "调色板(P)",
        4: "灰度+Alpha",
        6: "RGBA"
    };
    return names[colorType] || `未知 (${colorType})`;
}