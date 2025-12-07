import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import axios from 'axios';
import * as jwt from 'jsonwebtoken'; // 鉴权用
import sharp from 'sharp';           // 图片压缩用
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
    private readonly visionModel: ChatOpenAI;
    private readonly creativeModel: ChatOpenAI;
    private readonly logger = new Logger(VideoService.name);

    constructor(private configService: ConfigService) {
        // 1. 初始化 OSS
        this.ossClient = new OSS({
            region: this.configService.get('OSS_REGION'),
            accessKeyId: this.configService.get('OSS_ACCESS_KEY_ID'),
            accessKeySecret: this.configService.get('OSS_ACCESS_KEY_SECRET'),
            bucket: this.configService.get('OSS_BUCKET'),
            secure: true,
        });

        const apiKey = this.configService.get('DASHSCOPE_API_KEY');

        // 2. 初始化视觉模型 (使用 Plus 版本平衡速度与效果)
        this.visionModel = new ChatOpenAI({
            modelName: "qwen-vl-plus",
            apiKey: apiKey,
            configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
            temperature: 0.1,
        });

        // 3. 初始化创意模型 (使用 Turbo 版本极大提升速度)
        this.creativeModel = new ChatOpenAI({
            modelName: "qwen-turbo",
            apiKey: apiKey,
            configuration: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
            temperature: 0.8,
        });
    }

    // =========================================================
    // 1. 核心功能：分析图片并生成分镜脚本 (已恢复完整逻辑)
    // =========================================================
    async generateVideoPrompts(file: Express.Multer.File, productName: string) {
        // A. 图片预处理：压缩到 1024px 以内，提升上传和识别速度
        const compressedBuffer = await sharp(file.buffer)
            .resize({ width: 1024, height: 1024, fit: 'inside' })
            .jpeg({ quality: 80 })
            .toBuffer();

        const suffix = 'jpg';
        const key = `ai-video/${Date.now()}_${Math.random().toString(36).slice(-5)}.${suffix}`;

        // B. 上传到 OSS
        await this.ossClient.put(key, compressedBuffer, { headers: { 'x-oss-acl': 'public-read' } });

        let region = this.configService.get('OSS_REGION');
        if (!region.startsWith('oss-')) region = `oss-${region}`;
        const imageUrl = `https://${this.configService.get('OSS_BUCKET')}.${region}.aliyuncs.com/${key}`;

        this.logger.log(`[Video] 1/3 图片已上传: ${imageUrl}`);

        // C. Qwen-VL 看图 (简化 Prompt 减少 Token 输出)
        const visionRes = await this.visionModel.pipe(new StringOutputParser()).invoke([
            new HumanMessage({
                content: [
                    { type: "text", text: "简要描述画面中的主体、光影氛围和构图视角。" },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]
            })
        ]);

        this.logger.log(`[Video] 2/3 视觉分析完成，正在构思脚本...`);

        // D. Qwen-Turbo 写脚本
        const parser = new JsonOutputParser<VideoPromptResult>();
        const promptSystem = `你是一个好莱坞商业导演。基于商品"${productName}"和画面描述，设计 3 组 5秒电商广告的分镜脚本。
    
    画面描述: ${visionRes}
    
    要求输出 JSON: { "prompts": [ { "style": "风格(如: 极简/赛博朋克)", "description": "中文分镜描述", "english_prompt": "英文生成提示词(含High quality, 4k...)" } ] }
    ${parser.getFormatInstructions()}`;

        const creativeRes = await this.creativeModel.pipe(parser).invoke([new HumanMessage(promptSystem)]);

        this.logger.log(`[Video] 3/3 脚本生成完毕，共 ${creativeRes.prompts.length} 组`);

        return { imageUrl, prompts: creativeRes.prompts };
    }

    // =========================================================
    // 2. 提交 Kling 任务 (已根据官方 Curl 修正)
    // =========================================================
    async submitKlingTask(imageUrl: string, prompt: string) {
        // 建议在 .env 中配置: KLING_API_URL=https://api-beijing.klingai.com/v1
        const apiBaseUrl = this.configService.get('KLING_API_URL') || 'https://api-beijing.klingai.com/v1';
        const token = this.getKlingAuthToken();

        const headers: any = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        // 🟢 根据官方 Curl 翻译的请求体
        const payload = {
            "model_name": "kling-v1",
            "mode": "std",          // ⚠️ 注意：pro 模式消耗 35 点数，std 模式消耗 10 点数
            "duration": "5",        // 字符串格式的 "5"
            "image": imageUrl,
            "prompt": prompt,
            "cfg_scale": 0.5,

            // --- 下面是可选的高级参数，暂时注释掉，按需开启 ---
            // "static_mask": "https://...", 
            // "dynamic_masks": [
            //   {
            //     "mask": "https://...",
            //     "trajectories": [{"x": 279, "y": 219}, {"x": 417, "y": 65}]
            //   }
            // ]
        };

        try {
            this.logger.log(`[Kling] 提交任务到: ${apiBaseUrl}/videos/image2video`);
            this.logger.log(`[Kling] 参数: ${JSON.stringify(payload)}`);

            const response = await axios.post(`${apiBaseUrl}/videos/image2video`, payload, { headers });
            const resData = response.data;

            const taskId = resData.data?.task_id || resData.data?.id;
            this.logger.log(`[Kling] 任务提交成功 ID: ${taskId}`);
            return { taskId };

        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
                const data = error.response?.data || {};

                this.logger.error(`[Kling] HTTP错误: ${status} - ${JSON.stringify(data)}`);

                // 🟢 场景 1: 余额不足 (Code 1102)
                // 我们抛出 400 Bad Request，并带上自定义的中文提示
                if (data.code === 1102 || data.message?.includes('balance')) {
                    throw new HttpException(
                        '账户余额不足，请充值或在代码中切换为 mode: "std" 标准模式',
                        HttpStatus.BAD_REQUEST
                    );
                }

                // 🟢 场景 2: 其他 API 错误
                // 直接将服务商返回的 message 透传给前端
                throw new HttpException(
                    data.message || `服务商请求失败 (${status})`,
                    status // 保持原始 HTTP 状态码 (如 400, 429 等)
                );

            } else {
                // 🟢 场景 3: 代码运行错误 (非 Axios 错误)
                this.logger.error(`[Kling] 代码执行异常: ${error.message}`);
                throw new HttpException(
                    '服务器内部处理异常: ' + error.message,
                    HttpStatus.INTERNAL_SERVER_ERROR
                );
            }
        }
    }

    // =========================================================
    // 3. 查询状态 (含 JWT 鉴权修复)
    // =========================================================
    async getKlingStatus(taskId: string) {
        const apiBaseUrl = this.configService.get('KLING_API_URL');
        const token = this.getKlingAuthToken();

        const headers: any = { 'Content-Type': 'application/json' };
        if (this.isOfficialMode()) {
            headers['Authorization'] = `Bearer ${token}`;
        } else {
            headers['Authorization'] = `Bearer ${token}`;
            headers['x-api-key'] = token;
        }

        try {
            const response = await axios.get(`${apiBaseUrl}/videos/image2video/${taskId}`, { headers });
            const taskData = response.data.data;
            const statusMap = { 'succeeded': 'SUCCEEDED', 'failed': 'FAILED', 'processing': 'RUNNING', 'created': 'RUNNING' };

            // 兼容不同API返回的状态字段
            const currentStatus = taskData?.task_status || taskData?.status;
            const normalizedStatus = statusMap[currentStatus] || 'RUNNING';

            let videoUrl = '';
            if (normalizedStatus === 'SUCCEEDED') {
                videoUrl = taskData.task_result?.videos?.[0]?.url || taskData.output?.url;
            }

            return { status: normalizedStatus, video_url: videoUrl, message: taskData?.task_status_msg };
        } catch (error) {
            return { status: 'RUNNING', video_url: '' }; // 报错也继续轮询
        }
    }

    // --- 鉴权辅助方法 ---
    private getKlingAuthToken(): string {
        if (this.isOfficialMode()) {
            const accessKey = this.configService.get('KLING_ACCESS_KEY');
            const secretKey = this.configService.get('KLING_SECRET_KEY');

            if (!accessKey || !secretKey) {
                throw new Error('可灵API密钥未配置');
            }

            // 获取当前时间戳 (秒)
            const now = Math.floor(Date.now() / 1000);

            // 构造 Payload
            const payload = {
                iss: accessKey,      // 发行者
                exp: now + 1800,      // 过期时间: 30分钟后
                nbf: now - 300        // 生效时间: 倒退5分钟 (防止服务器时间误差导致验证失败)
            };

            // 构造 Header
            const header = {
                alg: "HS256",
                typ: "JWT"
            };

            // 生成签名
            const token = jwt.sign(payload, secretKey, {
                header: header,
                noTimestamp: true // 建议加上，仅包含 payload 中定义的字段
            });
            this.logger.log(`[Kling] 生成JWT成功: ${token}`);
            return token;
        } else {
            return this.configService.get('KLING_API_KEY') || '';
        }
    }

    private isOfficialMode(): boolean {
        return !!this.configService.get('KLING_SECRET_KEY');
    }
}