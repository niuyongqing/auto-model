import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpException } from '@nestjs/common';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  // 1. 定义一个 Mock 的 AppService
  // 这样测试时就不会真的去连接阿里云 OSS 或 OpenAI，只会模拟返回结果
  const mockAppService = {
    generateImages: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService, // 注入 Mock 对象
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('generate', () => {
    // 测试用例 1: 正常上传文件的情况
    it('should return generated images data', async () => {
      // 准备模拟数据
      const mockFile = {
        fieldname: 'file',
        originalname: 'test.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('fake-image-content'),
        size: 1024,
      } as Express.Multer.File;

      const mockProductName = 'Test Product';

      // 模拟 Service 返回的结果
      const mockResult = [
        { style: 'Modern', title: 'Title 1', imageUrl: 'http://oss/img1.png' }
      ];
      mockAppService.generateImages.mockResolvedValue(mockResult);

      // 执行控制器方法
      const result = await appController.generate(mockFile, mockProductName);

      // 验证结果
      expect(result).toEqual({ success: true, data: mockResult });
      // 验证 Service 是否被正确调用
      expect(appService.generateImages).toHaveBeenCalledWith(mockFile, mockProductName);
    });

    // 测试用例 2: 没有上传文件的情况
    it('should throw error if no file uploaded', async () => {
      try {
        await appController.generate(undefined as any, 'Test Product');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.message).toBe('请上传文件');
        expect(error.getStatus()).toBe(400);
      }
    });

    // 测试用例 3: Service 抛出异常的情况（比如 OSS 挂了）
    it('should handle service errors', async () => {
      const mockFile = { buffer: Buffer.from('') } as Express.Multer.File;
      const mockProductName = 'Test Product';

      // 模拟 Service 报错
      mockAppService.generateImages.mockRejectedValue(new Error('OSS Error'));

      try {
        await appController.generate(mockFile, mockProductName);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        // 根据你在 controller 里的写法，这里可能会包装错误信息
        expect(error.getResponse()).toEqual({ success: false, error: 'OSS Error' });
        expect(error.getStatus()).toBe(500);
      }
    });
  });
});