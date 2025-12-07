import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import OpenAI from 'openai'; // 用于调用 DashScope 万相 API
import axios from 'axios';
import sharp from 'sharp'; // 图像处理库
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process'; // 引入 exec创建子进程
import { promisify } from 'util';
const execAsync = promisify(exec); //将 exec 函数转换为 Promise 风格，方便await调用


@Injectable()
export class AppService {
  private readonly ossClient: OSS;
  private readonly aliClient: OpenAI;
  private readonly logger = new Logger(AppService.name);

  constructor(private configService: ConfigService) {
    // 初始化 OSS 客户端
    this.ossClient = new OSS({
      region: this.configService.get('OSS_REGION'),
      accessKeyId: this.configService.get('OSS_ACCESS_KEY_ID'),
      accessKeySecret: this.configService.get('OSS_ACCESS_KEY_SECRET'),
      bucket: this.configService.get('OSS_BUCKET'),
      secure: true,
    });

    // 初始化阿里云百炼 (DashScope) 客户端，兼容 OpenAI SDK 协议
    this.aliClient = new OpenAI({
      apiKey: this.configService.get('DASHSCOPE_API_KEY'),
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  }

  /**
   * 核心业务入口：生成商品营销图
   * 流程：上传 -> (并行: 文案分析 + 抠图) -> 串行生图
   * @param file 前端上传的文件对象
   * @param productName 商品名称
   */
  async generateImages(file: Express.Multer.File, productName: string) {
    try {
      this.logger.log(`[Start] 开始处理商品: ${productName}`);

      // Step 1: 上传原图到 OSS
      // 原因：Qwen-VL 大模型分析图片需要公网可访问的 URL，不能直接传 Buffer
      const originalUrl = await this.uploadToOSS(file.buffer, file.originalname);
      this.logger.log(`[1/4] 原图上传成功: ${originalUrl}`);

      // Step 2: 并行执行：文本分析 & 智能抠图
      // 原因：文案分析和抠图是独立的任务，并行执行可以显著提升效率
      const [strategies, transparentOssUrl] = await Promise.all([
        this.analyzeAndGetStrategies(originalUrl, productName),
        this.processSegmentation(file.buffer)
      ]);

      this.logger.log(`[2/4] 策略分析完成，共 ${strategies.length} 个方案`);
      this.logger.log(`[3/4] 抠图完成: ${transparentOssUrl}`);

      // 串行提交万相任务
      // 原因：万相模型有并发限制，不能同时提交多个任务
      const results: any[] = [];

      for (const strategy of strategies) {
        try {
          // 调用万相生成背景，传入透明图 URL 和大模型生成的 Prompt
          const imageUrl = await this.callWanxApi(transparentOssUrl, strategy.image_prompt, strategy.title);
          results.push({ ...strategy, imageUrl });

          // 等待 1s 避免 QPS 超限制
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          // 单个风格失败不影响整体，记录错误并继续下一个
          this.logger.error(`风格 [${strategy.title}] 生成失败: ${err.message}`);
          continue;
        }
      }

      if (results.length === 0) {
        throw new Error("所有方案生成均失败");
      }

      this.logger.log(`[End] 全部完成，成功生成 ${results.length} 张图片`);
      return results;

    } catch (error) {
      this.logger.error('处理流程失败', error);
      throw new HttpException(error.message || '生成失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * 核心技术难点：本地智能抠图 (独立进程模式)
   * 作用：将输入图片背景移除，生成透明 PNG
   * 架构：主进程负责 I/O，子进程负责计算，彻底解决 DLL 冲突导致的崩溃问题
   */
  async processSegmentation(inputBuffer: Buffer): Promise<string> {
    this.logger.log(`[1/3] 正在进行本地智能抠图 (独立进程模式)...`);

    const timestamp = Date.now();
    // 定义临时文件路径 (输入和输出)
    // 注意：必须使用物理文件，因为子进程无法直接共享主进程的内存 Buffer
    const tempInputPath = path.resolve(process.cwd(), `temp_in_${timestamp}.png`);
    const tempOutputPath = path.resolve(process.cwd(), `temp_out_${timestamp}.png`);
    // 指向外部的纯 JS 脚本 (位于项目根目录/scripts/remove-bg.js)
    // 这样做是为了绕过 NestJS 的编译环境，直接用 Node 原生执行，避免环境污染
    const workerScript = path.resolve(process.cwd(), 'scripts', 'remove-bg.js');

    try {
      // 1. 预处理：清洗图片格式
      // 用户可能上传 WebP/JPG，且可能包含损坏的头信息。
      // 用 Sharp 统一转为标准 PNG 存入硬盘，保证子进程读到的是完美的文件。
      await sharp(inputBuffer).png().toFile(tempInputPath);

      // 2. 【架构核心】启动子进程 (Child Process)
      // 使用 'exec' 调用 'node scripts/remove-bg.js <入> <出>'
      // 这一步将 @imgly 库的运行完全隔离在主进程之外。即使它崩了，主进程也能捕获错误而不是直接退出。
      this.logger.log(`    -> 启动子进程处理...`);

      try {
        // 3. 执行子进程：调用 remove-bg.js 处理图片
        // 这一步会阻塞主进程，等待子进程完成。
        // 子进程完成后，会在 tempOutputPath 生成透明 PNG 图片。
        const { stderr } = await execAsync(`node "${workerScript}" "${tempInputPath}" "${tempOutputPath}"`);
        if (stderr && !stderr.includes('warn')) { // 忽略非致命警告
          console.log('Worker Log:', stderr);
        }
      } catch (execError) {
        throw new Error(`子进程崩溃: ${execError.message}\n${execError.stderr}`);
      }

      // 4. 读取子进程的输出结果
      if (!fs.existsSync(tempOutputPath)) {
        throw new Error('子进程执行完毕，但未生成输出文件');
      }

      const rawBuffer = fs.readFileSync(tempOutputPath);
      this.logger.log(`    -> 子进程处理完成，读取结果: ${rawBuffer.length} bytes`);

      // 5. 标准化 (PNG -> RGBA) & 上传 OSS
      // 原因：@imgly 生成的透明 PNG 可能不是标准 RGBA 格式，
      // 而 OSS 要求上传的图片必须是 RGBA 格式。
      // 用 Sharp 转换确保格式一致，避免后续处理错误。
      const finalRgbaBuffer = await sharp(rawBuffer)
        .ensureAlpha()
        .png({ palette: false, compressionLevel: 9, force: true })
        .toBuffer();
      this.logger.log(`    -> 转换为 RGBA 格式: ${finalRgbaBuffer.length} bytes`);

      // 6. 上传 OSS
      // 原因：万相模型需要透明图作为输入，而 OSS 是存储透明 PNG 的唯一格式。
      // 上传后，万相模型可以直接使用 URL 访问透明图。
      const filename = `ai-transparent/${Date.now()}_masked.png`;
      await this.ossClient.put(filename, finalRgbaBuffer, {
        headers: { 'Content-Type': 'image/png', 'x-oss-acl': 'public-read' },
      });
      this.logger.log(`    -> OSS 上传成功: ${filename}`);

      // 7. 生成公开访问 URL
      // 原因：万相模型需要透明图的公开 URL 作为输入。
      // 生成 URL 后，万相模型可以直接访问该图片。
      let region = this.configService.get('OSS_REGION') || '';
      if (!region.startsWith('oss-')) region = `oss-${region}`;
      const finalUrl = `https://${this.configService.get('OSS_BUCKET')}.${region}.aliyuncs.com/${filename}`;

      return finalUrl;

    } catch (error) {
      this.logger.error('❌ 抠图流程出错:', error);
      throw error;
    } finally {
      // 8. 清理现场 (非常重要！)
      // 无论成功还是失败，都必须删除硬盘上的临时图片，防止服务器磁盘爆满
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    }
  }

  // --- 辅助方法：普通上传 (用于原图) ---
  private async uploadToOSS(buffer: Buffer, originalName: string): Promise<string> {
    const suffix = originalName.split('.').pop() || 'png';
    // 9. 生成文件名
    // 原因：为了避免文件名冲突，使用时间戳 + 随机字符串。
    // 同时，保持文件名的可读性，方便后续查询。
    const filename = `ai-upload/${Date.now()}_${Math.random().toString(36).slice(-5)}.${suffix}`;

    await this.ossClient.put(filename, buffer, {
      headers: { 'x-oss-acl': 'public-read' }
    });
    this.logger.log(`    -> OSS 上传成功: ${filename}`);

    let region = this.configService.get('OSS_REGION');
    if (!region.startsWith('oss-')) region = `oss-${region}`;

    return `https://${this.configService.get('OSS_BUCKET')}.${region}.aliyuncs.com/${filename}`;
  }

  /**
   * 调用 Qwen-VL (通义千问视觉版) 分析商品
   * 作用：根据图片理解商品，并生成 3 个不同的场景推广 Prompt
   */
  private async analyzeAndGetStrategies(imageUrl: string, productName: string) {
    this.logger.log(`正在分析商品: ${productName}...`);
    const response = await this.aliClient.chat.completions.create({
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

    const rawContent = response.choices[0].message.content || '';
    let content = rawContent.replace(/```json/g, '').replace(/```/g, '');
    return JSON.parse(content).strategies;
  }

  /**
   * 调用阿里云万相 (Wanx) 生成背景
   * 模式：异步任务轮询 (Task Polling)
   */
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
            input: {
              base_image_url: transparentUrl,// 透明图 URL
              ref_prompt: prompt,// Qwen 生成的背景描述
            },
            parameters: { n: 1 }
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'X-DashScope-Async': 'enable',// 开启异步模式
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
      if (status === 'SUCCEEDED') {
        return res.data.output.results[0].url;
      }
      if (status === 'FAILED') {
        throw new Error(`万相报错: ${res.data.output.message}`);
      }
    }
  }
}