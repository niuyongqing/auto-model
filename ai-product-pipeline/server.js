require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const OSS = require('ali-oss');
const OpenAI = require('openai');
const fal = require("@fal-ai/serverless-client");
const sharp = require('sharp'); // 【新增】用于图片处理
const axios = require('axios'); // 【新增】用于下载图片流

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// === 1. 配置各路客户端 ===

// A. 配置 Fal.ai (负责抠图 + 保持商品一致性的重绘)
fal.config({
    credentials: process.env.FAL_KEY,
});

// B. 配置阿里云 Qwen (负责看图 + 写文案)
const aliClient = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

// C. 配置阿里云 OSS (负责存储图片以获取公网链接)
const ossClient = new OSS({
    region: process.env.OSS_REGION,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
    secure: true // 使用 HTTPS
});

// === 2. 核心工具函数 ===

/**
 * 上传本地文件到 OSS，返回公网可访问的 URL
 * (高级 AI 模型通常只接受 URL，不接受 Base64)
 */
async function uploadToOSS(filePath, originalName) {
    try {
        const suffix = originalName.split('.').pop();
        const filename = `ai-upload/${Date.now()}.${suffix}`;

        // 上传到 OSS
        const result = await ossClient.put(filename, filePath);

        // 返回永久链接
        return result.url;
    } catch (e) {
        console.error("OSS 上传失败:", e);
        throw new Error("图片上传云存储失败，请检查 OSS 配置");
    }
}

/**
 * 【新增核心函数】把 Bria 的透明图转换成 Flux 需要的黑白 Mask，并上传到 OSS
 */
async function createMaskAndUpload(transparentImageUrl) {
    try {
        // 1. 下载透明图
        const response = await axios({ url: transparentImageUrl, responseType: 'arraybuffer' });
        const inputBuffer = response.data;

        // 2. 用 Sharp 处理：提取Alpha -> 转黑白 -> 反色
        // 逻辑：透明部分(Alpha=0) -> 变黑(0) -> 反色成白(255) [白色=重画背景]
        //      实体部分(Alpha=255) -> 变白(255) -> 反色成黑(0) [黑色=保留商品]
        const maskBuffer = await sharp(inputBuffer)
            .ensureAlpha()
            .extractChannel(3)     // 提取 Alpha 通道
            .toColourspace('b-w')  // 转灰度
            .negate({ alpha: false }) // 反转颜色 (关键！)
            .png()
            .toBuffer();

        // 3. 上传 Mask 到 OSS 以获取 URL
        const maskUrl = await uploadToOSS(maskBuffer, 'mask.png');
        return maskUrl;
    } catch (error) {
        console.error("蒙版生成失败:", error);
        throw error;
    }
}

/**
 * 第一步：视觉分析与策略生成 (Qwen-VL-Max)
 */
async function analyzeAndGetStrategies(imageUrl, productName) {
    console.log(`[1/3] Qwen 正在策划方案: ${productName}...`);

    const response = await aliClient.chat.completions.create({
        model: "qwen-vl-max",
        messages: [
            {
                role: "system",
                content: `你是一个跨境电商爆款策划专家。请根据用户上传的商品图片和名称，策划 3 组不同的推广方案。
                
                场景要求：
                1. 方案A: 极简高级 (Minimalist Studio)
                2. 方案B: 户外/生活实景 (Outdoor/Lifestyle)
                3. 方案C: 创意/温馨 (Creative/Cozy)
                
                对于每个方案，输出：
                - style: 风格名
                - title: 适配该风格的 Amazon 英文标题 (含关键词)
                - image_prompt: 适配该风格的英文绘画提示词 (只描述背景环境、光影、氛围，不要描述商品本身)
                
                返回纯 JSON 格式：
                { "strategies": [ { "style": "...", "title": "...", "image_prompt": "..." }, ... ] }`
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

    // 清理可能存在的 markdown 标记
    let content = response.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '');
    return JSON.parse(content).strategies;
}

/**
 * 【修正】生成最终图片
 * 使用 flux-pro/v1/fill，传入 原图 + 蒙版 + 提示词
 */
async function generateConsistentImage(item, originalUrl, maskUrl) {
    console.log(`[3/4] Flux Fill 正在重绘背景: ${item.style}...`);

    const result = await fal.subscribe("fal-ai/flux-pro/v1/fill", {
        input: {
            prompt: item.image_prompt,
            image_url: originalUrl, // 【重点】这里传原始拍摄的图
            mask_url: maskUrl,      // 【重点】这里传我们算出来的黑白蒙版
            guidance_scale: 30,     // 稍微高一点，让它严格遵守蒙版
            output_format: "jpeg",
            sync_mode: true
        },
        logs: true
    });

    return result.data.images[0].url; // 注意 Fal 返回结构可能是 data.images
}

// === 3. API 路由 ===

app.post('/api/generate', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;
    
    try {
        if (!filePath) return res.status(400).json({ error: '请上传图片' });
        const productName = req.body.productName || "Product";

        console.log("=== 新任务开始 ===");

        // 1. 上传原图
        const originalUrl = await uploadToOSS(filePath, req.file.originalname);
        console.log("原图 URL:", originalUrl);

        // 2. 并行：分析策略 + 抠图 (用 Bria 模型)
        console.log("正在执行：策略分析 & 智能抠图...");
        
        // 修正：这里不能用 Promise.all 简单的并行，因为我们需要先拿到 Bria 的结果来做 Mask
        // 但 Qwen 和 Bria 可以并行
        const [strategies, briaResult] = await Promise.all([
            analyzeAndGetStrategies(originalUrl, productName), // 您的 Qwen 函数
            
            // 【修正】使用 Bria RMBG 2.0 去背景
            fal.subscribe("fal-ai/bria/background/remove", {
                input: { image_url: originalUrl }
            })
        ]);

        const transparentPngUrl = briaResult.data.image.url; 
        console.log("抠图完成(透明图):", transparentPngUrl);

        // 3. 【新增】制作黑白蒙版
        console.log("正在生成黑白蒙版...");
        const maskUrl = await createMaskAndUpload(transparentPngUrl);
        console.log("蒙版 URL:", maskUrl);

        // 4. 批量裂变
        console.log(`开始生成 ${strategies.length} 张变体...`);
        
        const generateTasks = strategies.map(async (strategy) => {
            // 传入: 策略, 原图URL, 蒙版URL
            const finalImageUrl = await generateConsistentImage(strategy, originalUrl, maskUrl);
            
            return {
                style: strategy.style,
                title: strategy.title,
                imageUrl: finalImageUrl
            };
        });

        const finalResults = await Promise.all(generateTasks);

        // 清理
        fs.unlinkSync(filePath);
        
        console.log("=== 任务完成 ===");
        res.json({ success: true, data: finalResults });

    } catch (error) {
        console.error("流水线出错:", error);
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3333;
app.listen(PORT, () => {
    console.log(`生成引擎已启动: http://localhost:${PORT}`);
});