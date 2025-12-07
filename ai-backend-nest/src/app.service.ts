import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";

const execAsync = promisify(exec);

interface Strategy {
  style: string;
  title: string;
  image_prompt: string;
}

interface StrategyOutput {
  strategies: Strategy[];
}

@Injectable()
export class AppService {
  private readonly ossClient: OSS;
  private readonly chatModel: ChatOpenAI;
  private readonly logger = new Logger(AppService.name);

  constructor(private configService: ConfigService) {
    // 1. 初始化 OSS
    this.ossClient = new OSS({
      region: this.configService.get('OSS_REGION'),
      accessKeyId: this.configService.get('OSS_ACCESS_KEY_ID'),
      accessKeySecret: this.configService.get('OSS_ACCESS_KEY_SECRET'),
      bucket: this.configService.get('OSS_BUCKET'),
      secure: true,
    });

    // 2. 【修复关键点】获取并检查 API Key
    const apiKey = this.configService.get<string>('DASHSCOPE_API_KEY');

    if (!apiKey) {
      this.logger.error("❌ 严重错误: 未能在环境变量中找到 DASHSCOPE_API_KEY！");
      this.logger.error("   -> 请检查 .env 文件是否存在且位于项目根目录。");
      this.logger.error("   -> 请检查 ConfigModule 是否在 AppModule 中正确配置。");
    } else {
      // 安全地打印 Key 的前几位，确认读取成功
      this.logger.log(`✅ LangChain 初始化成功，使用 API Key: ${apiKey.substring(0, 8)}...`);
    }

    // 3. 初始化 LangChain
    this.chatModel = new ChatOpenAI({
      modelName: "qwen-vl-max",
      apiKey: apiKey,
      openAIApiKey: apiKey, // 双重保险
      configuration: {
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      temperature: 0.7,
    });
  }

  async generateImages(file: Express.Multer.File, productName: string) {
    try {
      this.logger.log(`[Start] 开始处理商品: ${productName}`);

      const suffix = file.originalname.split('.').pop() || 'png';
      const originalKey = `ai-upload/${Date.now()}_${Math.random().toString(36).slice(-5)}.${suffix}`;
      const mimeType = file.mimetype || `image/${suffix}`;
      const originalUrl = await this.uploadBufferToOSS(file.buffer, originalKey, mimeType);

      this.logger.log(`[1/4] 原图上传成功: ${originalUrl}`);

      const [strategies, transparentOssUrl] = await Promise.all([
        this.analyzeWithLangChain(originalUrl, productName),
        this.processSegmentation(file.buffer)
      ]);

      this.logger.log(`[2/4] 策略分析完成，共 ${strategies.length} 个方案`);
      this.logger.log(`[3/4] 抠图完成: ${transparentOssUrl}`);

      const results: any[] = [];
      for (const strategy of strategies) {
        try {
          const imageUrl = await this.callWanxApi(transparentOssUrl, strategy.image_prompt, strategy.title);
          results.push({ ...strategy, imageUrl });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          this.logger.error(`风格 [${strategy.title}] 生成失败: ${err.message}`);
          continue;
        }
      }

      if (results.length === 0) throw new Error("所有方案生成均失败");

      this.logger.log(`[End] 全部完成，成功生成 ${results.length} 张图片`);
      return results;

    } catch (error) {
      this.logger.error('处理流程失败', error);
      throw new HttpException(error.message || '生成失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async analyzeWithLangChain(imageUrl: string, productName: string): Promise<Strategy[]> {
    this.logger.log(`[LangChain] 正在分析商品: ${productName}...`);

    const parser = new JsonOutputParser<StrategyOutput>();

    // 🔥【关键修改】在 Prompt 中显式规定 JSON 字段名，防止 AI 发挥过度
    const systemPrompt = `你是一个跨境电商策划专家。根据用户提供的商品图片和名称，策划 3 组推广方案。
    
    请严格按照以下 JSON 格式输出，不要包含 Markdown 代码块（如 \`\`\`json）：
    {
      "strategies": [
        {
          "style": "风格名称 (例如: 极简风)",
          "title": "营销标题 (例如: 夏季必备)",
          "image_prompt": "生图提示词 (重要: 必须是英文, 只描述背景环境、光影、氛围，不要描述商品本身)"
        }
      ]
    }
    
    确保数组中包含 3 个对象，且字段名必须完全一致（style, title, image_prompt）。
    
    ${parser.getFormatInstructions()}`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage({
        content: [
          { type: "text", text: `商品名称: ${productName}` },
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
            },
          },
        ],
      }),
    ];
    // 4. 执行 LangChain 链
    const chain = this.chatModel.pipe(parser); // 链：模型 -> 解析器

    try {
      const result = await chain.invoke(messages);// 执行链，返回解析后的结果

      // 添加防御性检查，防止 AI 返回空数组或字段缺失
      if (!result.strategies || !Array.isArray(result.strategies)) {
        this.logger.error("AI 返回格式错误:", result);
        throw new Error("AI 返回数据格式异常");
      }

      return result.strategies;
    } catch (e) {
      this.logger.error("LangChain 分析失败:", e);
      // 如果解析失败，抛出错误让主流程捕获
      throw new Error("文案分析服务暂时不可用: " + e.message);
    }
  }

  async processSegmentation(inputBuffer: Buffer): Promise<string> {
    this.logger.log(`[1/3] 正在进行本地智能抠图...`);
    const timestamp = Date.now();
    const tempInputPath = path.resolve(process.cwd(), `temp_in_${timestamp}.png`);
    const tempOutputPath = path.resolve(process.cwd(), `temp_out_${timestamp}.png`);
    const workerScript = path.resolve(process.cwd(), 'scripts', 'remove-bg.js');

    try {
      await sharp(inputBuffer).png().toFile(tempInputPath);

      const { stderr } = await execAsync(`node "${workerScript}" "${tempInputPath}" "${tempOutputPath}"`);
      if (stderr && !stderr.includes('warn')) console.log('Worker Log:', stderr);

      if (!fs.existsSync(tempOutputPath)) throw new Error('子进程未生成文件');

      const rawBuffer = fs.readFileSync(tempOutputPath);
      const finalRgbaBuffer = await sharp(rawBuffer)
        .ensureAlpha()
        .png({ palette: false, compressionLevel: 9, force: true })
        .toBuffer();

      const transparentKey = `ai-transparent/${Date.now()}_masked.png`;
      return await this.uploadBufferToOSS(finalRgbaBuffer, transparentKey, 'image/png');

    } catch (error) {
      this.logger.error('❌ 抠图流程出错:', error);
      throw error;
    } finally {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    }
  }

  private async uploadBufferToOSS(buffer: Buffer, key: string, mimeType: string): Promise<string> {
    try {
      await this.ossClient.put(key, buffer, {
        headers: {
          'x-oss-acl': 'public-read',
          'Content-Type': mimeType
        }
      });
      let region = this.configService.get('OSS_REGION');
      if (!region.startsWith('oss-')) region = `oss-${region}`;
      return `https://${this.configService.get('OSS_BUCKET')}.${region}.aliyuncs.com/${key}`;
    } catch (error) {
      throw new Error(`OSS上传失败: ${error.message}`);
    }
  }

  private async callWanxApi(transparentUrl: string, prompt: string, title: string): Promise<string> {
    const apiKey = this.configService.get('DASHSCOPE_API_KEY');
    let taskId = '';
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.log(`[万相] 提交任务 "${title}" (第 ${attempt} 次)`);
        await axios.head(transparentUrl);
        const response = await axios.post(
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/background-generation/generation',
          {
            model: 'wanx-background-generation-v2',
            input: { base_image_url: transparentUrl, ref_prompt: prompt },
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
        taskId = response.data.output.task_id;
        break;
      } catch (error) {
        this.logger.warn(`提交失败: ${error.message}`);
        if (attempt === MAX_RETRIES) throw error;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }

    const startTime = Date.now();
    while (true) {
      if (Date.now() - startTime > 90000) throw new Error("生图超时");
      await new Promise(r => setTimeout(r, 2000));
      const res = await axios.get(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const status = res.data.output.task_status;
      if (status === 'SUCCEEDED') return res.data.output.results[0].url;
      if (status === 'FAILED') throw new Error(`万相报错: ${res.data.output.message}`);
    }
  }
}