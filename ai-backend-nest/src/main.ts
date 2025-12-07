// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 开启跨域，允许前端 3332 访问
  app.enableCors();

  await app.listen(3333);
  console.log(`Server running at http://localhost:3333`);
}
bootstrap();