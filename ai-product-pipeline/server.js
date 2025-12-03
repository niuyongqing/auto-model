require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const OSS = require('ali-oss');
const OpenAI = require('openai');
const fal = require("@fal-ai/serverless-client");

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
 * 第二步：抠图 + 保真重绘 (Flux Fill)
 * 这是保持商品长相不变的关键！
 */
async function generateConsistentImage(item, transparentImageUrl) {
    console.log(`[2/3] Flux 正在绘制背景: ${item.style}...`);

    // 调用 Flux.1 Fill 模型
    // 这个模型专门用于：给定一张透明底图，填充背景
    const result = await fal.subscribe("fal-ai/flux/pro/v1.1/fill", {
        input: {
            image_url: transparentImageUrl, // 传入已抠图的透明商品
            prompt: `product photography, ${item.image_prompt}, high quality, 8k, photorealistic, cinematic lighting, no text`,
            guidance_scale: 30, // 较高的引导值有助于保持物体边缘
            seed: Math.floor(Math.random() * 10000000), // 随机种子
            output_format: "jpeg",
            sync_mode: true
        }
    });

    return result.images[0].url;
}

// === 3. API 路由 ===

app.post('/api/generate', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;

    try {
        if (!filePath) return res.status(400).json({ error: '请上传图片' });
        const productName = req.body.productName || "Product";

        console.log("=== 新任务开始 ===");

        // 1. 上传原图到 OSS (为了给 AI 传 URL)
        console.log("正在上传原图到 OSS...");
        const originalUrl = await uploadToOSS(filePath, req.file.originalname);
        console.log("原图 URL:", originalUrl);

        // 2. 并行执行：(A) Qwen 分析策略  (B) 预先抠图
        console.log("正在并行执行：策略分析 & 智能抠图...");

        const [strategies, rembgResult] = await Promise.all([
            // A. 让 Qwen 出方案
            analyzeAndGetStrategies(originalUrl, productName),

            // B. 调用 Fal 去除背景 (得到透明底图)
            fal.subscribe("fal-ai/image-utils/remove-background", {
                input: { image_url: originalUrl }
            })
        ]);

        const transparentUrl = rembgResult.image.url;
        console.log("抠图完成，策略已生成。开始批量生图...");

        // 3. 根据 3 个策略，并发生成 3 张图 (使用 Flux Fill)
        const generateTasks = strategies.map(async (strategy) => {
            // 使用透明底图 + Qwen 写的 Prompt 进行重绘
            const finalImageUrl = await generateConsistentImage(strategy, transparentUrl);

            // (可选优化) 你可以在这里把 finalImageUrl 再转存回 OSS，变成永久链接
            // const permanentUrl = await uploadToOSS(downloadStream(finalImageUrl), 'result.jpg');

            return {
                style: strategy.style,
                title: strategy.title,
                imageUrl: finalImageUrl
            };
        });

        const finalResults = await Promise.all(generateTasks);

        // 4. 清理本地临时文件
        fs.unlinkSync(filePath);

        console.log("=== 任务完成，返回结果 ===");
        res.json({ success: true, data: finalResults });

    } catch (error) {
        console.error("流水线出错:", error);
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); // 出错也要清理垃圾
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`广铺生成引擎已启动: http://localhost:${PORT}`);
});