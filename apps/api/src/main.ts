import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as compression from 'compression';

import { AppModule } from './app.module';
import { EnvService } from './bootstrap/env/env.service';
import { AppLoggerService } from './bootstrap/logging/app-logger.service';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter';
import { setupSwagger } from './bootstrap/docs/swagger.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const envService = app.get(EnvService);
  const logger = app.get(AppLoggerService);

  app.useLogger(logger);

  // Trust N reverse-proxy hops so req.ip reflects the real client (used by
  // the rate-limiter to key per client IP, not the LB's IP). 0 disables.
  const trustProxyHops = envService.getNumber('TRUST_PROXY_HOPS', 0);
  if (trustProxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  }

  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ── Performance: gzip/deflate compression (60-70% bandwidth reduction) ──
  app.use(compression({
    threshold: 1024,  // Only compress responses > 1KB
    level: 6,         // Balanced speed vs compression ratio
  }));

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );

  app.enableCors({
    origin: envService.getCorsOrigins(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter(logger));

  if (!envService.isProduction()) {
    setupSwagger(app);
  }

  const port = envService.getNumber('PORT', 4000);

  await app.listen(port);

  logger.log(`API server running on port ${port}`, 'Bootstrap');
  if (!envService.isProduction()) {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
  }
}

bootstrap();
