import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageService } from './image.service';

@Controller('api/image') // ✅ 路由前缀改为 /api/image
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  @Post('generate')
  @UseInterceptors(FileInterceptor('file'))
  async generate(
    @UploadedFile() file: Express.Multer.File,
    @Body('productName') productName: string,
  ) {
    if (!file) throw new HttpException('无文件', HttpStatus.BAD_REQUEST);
    return await this.imageService.generateImages(
      file,
      productName || 'Product',
    );
  }
}
