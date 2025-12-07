import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import axios from 'axios';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { JsonOutputParser, StringOutputParser } from "@langchain/core/output_parsers";

interface VideoPromptResult {
    prompts: {
        style: string;
        description: string;
        english_prompt: string;
    }[];
}

@Injectable()
export class VideoService {
    private readonly ossClient: OSS;
    private readonly visionModel: ChatOpenAI;   // Qwen-VL (看)
    private readonly creativeModel: ChatOpenAI; // Qwen-Max (想)
    private readonly logger = new Logger(VideoService.name);

    constructor(private configService: ConfigService) {
        this.ossClient = new OSS({
            region: this.configService.get('OSS_REGION'),
            accessKeyId: this.configService.get('OSS_ACCESS_KEY_ID'),
            accessKeySecret: this.configService.get('OSS_ACCESS_KEY_SECRET'),
            bucket: this.configService.get('OSS_BUCKET'),
            secure: true,
        });

        const apiKey = this.configService.get('DASHSCOPE_API_KEY');

        // 初始化 Qwen-VL
        this.visionModel = new ChatOpenAI({
            modelName: "qwen-vl-max",
            apiKey: apiKey,
            configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
            temperature: 0.1,
        });

        // 初始化 Qwen-Max
        this.creativeModel = new ChatOpenAI({
            modelName: "qwen-max",
            apiKey: apiKey,
            configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
            temperature: 0.8,
        });
    }

    // 1. 分析图片生成灵感
    async generateVideoPrompts(file: Express.Multer.File, productName: string) {
        // 上传图片 (这里简单重复一次上传逻辑，保证模块解耦)
        const suffix = file.originalname.split('.').pop() || 'png';
        const key = `ai-video/${Date.now()}_${Math.random().toString(36).slice(-5)}.${suffix}`;
        await this.ossClient.put(key, file.buffer, { headers: { 'x-oss-acl': 'public-read' } });

        let region = this.configService.get('OSS_REGION');
        if (!region.startsWith('oss-')) region = `oss-${region}`;
        const imageUrl = `https://${this.configService.get('OSS_BUCKET')}.${region}.aliyuncs.com/${key}`;

        this.logger.log(`[Video] Qwen-VL 正在看图: ${imageUrl}`);

        // Step A: 看图
        const visionRes = await this.visionModel.pipe(new StringOutputParser()).invoke([
            new HumanMessage({
                content: [
                    { type: "text", text: "请极其详细地描述这张图片的画面内容、光影、质感、构图。" },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            })
        ]);

        this.logger.log(`[Video] Qwen-Max 正在构思...`);

        // Step B: 构思
        const parser = new JsonOutputParser<VideoPromptResult>();
        const promptSystem = `你是一个好莱坞商业导演。基于商品"${productName}"和画面描述，设计 3 组5秒电商广告的分镜脚本。
    画面描述: ${visionRes}
    
    要求输出 JSON: { "prompts": [ { "style": "...", "description": "中文分镜", "english_prompt": "英文提示词(含High quality, 4k, cinematic...)" } ] }
    ${parser.getFormatInstructions()}`;

        const creativeRes = await this.creativeModel.pipe(parser).invoke([new HumanMessage(promptSystem)]);

        return { imageUrl, prompts: creativeRes.prompts };
    }

    // 2. 提交 Kling 任务
    async submitKlingTask(imageUrl: string, prompt: string) {
        // ... (Kling API 调用逻辑，同上文) ...
        // 为演示，这里返回模拟 ID，实际请填写真实请求
        return { taskId: "mock_kling_" + Date.now() };
    }

    // 3. 查询状态
    async getKlingStatus(taskId: string) {
        // ... (Kling 状态查询逻辑) ...
        return { status: "SUCCEEDED", video_url: "http://demo-video.mp4" };
    }
}