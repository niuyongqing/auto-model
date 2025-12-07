// src/app.controller.ts
import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

@Controller('api') // 路由前缀
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Post('generate')
  @UseInterceptors(FileInterceptor('file')) // 对应 upload.single('file')
  async generate(
    @UploadedFile() file: Express.Multer.File,
    @Body('productName') productName: string,
  ) {
    if (!file) {
      throw new HttpException('请上传文件', HttpStatus.BAD_REQUEST);
    }

    try {
      const data = await this.appService.generateImages(file, productName || 'Product');
      return { success: true, data }; // 自动返回 JSON
    } catch (error) {
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}