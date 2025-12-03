// index.js
require('dotenv').config();
const OpenAI = require('openai');

// === 1. 初始化阿里云客户端 (Qwen-VL) ===
// 作用：看懂商品图片，写出英文 Prompt，写出不同语言的 Listing
const aliClient = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

// === 2. 初始化硅基流动客户端 (Flux) ===
// 作用：调用国内托管的 Flux 模型生成图片
const siliconClient = new OpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: "https://api.siliconflow.cn/v1"
});

/**
 * 步骤一：视觉分析
 * 让通义千问看图，并生成 N 个不同的绘画提示词
 */
async function analyzeAndGetPrompts(imageUrl) {
    console.log(`[1/3] 正在调用阿里云 Qwen-VL 分析商品...`);

    const response = await aliClient.chat.completions.create({
        model: "qwen-vl-max", // 阿里最强视觉模型
        messages: [
            {
                role: "system",
                content: "你是一个跨境电商视觉总监。请分析用户上传的商品图片（材质、颜色、形状）。\n" +
                    "任务：基于商品特征，生成 3 个截然不同的英文绘画 Prompt，用于生成高质量的商品背景图。\n" +
                    "场景要求：\n" +
                    "1. Modern Studio (极简影棚，适合电子/家居)\n" +
                    "2. Outdoor Nature (户外自然，适合运动/日用)\n" +
                    "3. Cozy Home (温馨居家，适合纺织/母婴)\n" +
                    "返回格式：纯 JSON 格式，不要 Markdown，Key 为 'prompts'，Value 是字符串数组。"
            },
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            }
        ],
        response_format: { type: "json_object" } // 强制返回 JSON，方便代码处理
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.prompts;
}

/**
 * 步骤二：图像生成
 * 调用 Flux 生成图片
 */
async function generateImage(prompt) {
    console.log(`[2/3] 正在调用硅基流动生成背景: "${prompt.substring(0, 15)}..."`);

    // 技巧：在 Prompt 后追加质量词，保证出图率
    const fullPrompt = `professional product photography, center subject, ${prompt}, 8k resolution, photorealistic, cinematic lighting, no text, no watermark, blurry background`;

    const response = await siliconClient.images.generate({
        model: "black-forest-labs/FLUX.1-schnell", // 推荐用 Schnell 版：速度极快(1秒出图)，成本极低，适合广铺
        prompt: fullPrompt,
        size: "1024x1024",
        n: 1
    });

    return response.data[0].url;
}

/**
 * 主流程：广铺发动机
 */
async function main() {
    // ⚠️ 注意：这里必须是一个公网可访问的 URL。
    // 如果你在本地测试，可以用 OSS 上传一张图拿到链接，或者找一张网图测试。
    const productImageUrl = "https://fastly.picsum.photos/id/757/200/200.jpg?hmac=63cyrpvD1Rfu-liH-cup8mezZlu53E5a-3bzcknXxxk"; // 示例：一张普通的商品图

    try {
        console.time("TotalTime");

        // 1. 获取 3 个不同的 Prompt
        const prompts = await analyzeAndGetPrompts(productImageUrl);
        console.log("--> 获取到 Prompts:", prompts);

        // 2. 并发生成 3 张图 (Promise.all 是 Node.js 处理高并发的神器)
        // 这一步会同时发起 3 个请求，极快
        const imageTasks = prompts.map(p => generateImage(p));
        const newImages = await Promise.all(imageTasks);

        console.log("\n[3/3] === 任务完成，生成结果如下 ===");
        newImages.forEach((url, index) => {
            console.log(`场景 ${index + 1}: ${url}`);
        });

        console.timeEnd("TotalTime");

    } catch (error) {
        console.error("流水线发生错误:", error);
        // 调试技巧：打印详细的 API 错误信息
        if (error.response) console.error(error.response.data);
    }
}

main();