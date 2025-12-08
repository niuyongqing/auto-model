import {
  Controller,
  Post,
  Get,
  Body,
  UseInterceptors,
  UploadedFile,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VideoService } from './video.service';

@Controller('api/video') // ✅ 路由前缀 /api/video
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post('analyze')
  @UseInterceptors(FileInterceptor('file'))
  async analyze(
    @UploadedFile() file: Express.Multer.File,
    @Body('productName') name: string,
  ) {
    return await this.videoService.generateVideoPrompts(file, name);
  }

  @Post('create')
  async create(@Body() body: { imageUrl: string; prompt: string }) {
    return await this.videoService.submitKlingTask(body.imageUrl, body.prompt);
  }

  @Get('status/:taskId')
  async status(@Param('taskId') id: string) {
    return await this.videoService.getKlingStatus(id);
  }
}
