import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { getNumber } from './common/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const corsOrigin = config.get<string>('API_CORS_ORIGIN', 'http://localhost:4200');

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(json({ limit: '2mb' }));
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigin.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  setupSwagger(app);

  await app.listen(getNumber(config, 'API_PORT', 3000), '0.0.0.0');
}

void bootstrap();
