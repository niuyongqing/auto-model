import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ImageModule } from './image/image.module'; // ✅ 导入 Image
import { VideoModule } from './video/video.module'; // ✅ 导入 Video

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '.env' }),
    ImageModule, // 注册
    VideoModule, // 注册
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
