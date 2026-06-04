// OpenTelemetry MUST initialize before any other import so the SDK
// can patch the Node module loader before Express/Prisma/Redis are
// cached. No-op when OTEL_ENABLED!=true or the packages aren't
// installed; see bootstrap/tracing/tracing.ts for the lazy-require +
// install instructions. Mirrors apps/api/src/main.ts.
import { initTracing } from './bootstrap/tracing/tracing';
initTracing();

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as compression from 'compression';

import { AppModule } from './app.module';
import { EnvService } from './bootstrap/env/env.service';
import { AppLoggerService } from './bootstrap/logging/app-logger.service';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter';
import { setupSwagger } from './bootstrap/docs/swagger';

// BigInt JSON serialisation: paise columns are BigInt in Prisma;
// JSON.stringify on a BigInt throws by default. Serialising as a
// string preserves precision (paise rollups can exceed
// Number.MAX_SAFE_INTEGER) and matches the wire format every
// paise-denominated API in the wild uses. Same monkey-patch as
// apps/api/src/main.ts so the two services agree.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const envService = app.get(EnvService);
  const logger = app.get(AppLoggerService);

  app.useLogger(logger);

  // Graceful shutdown — same pattern as apps/api. enableShutdownHooks
  // makes Nest call onModuleDestroy on every provider when the process
  // receives SIGTERM/SIGINT; the explicit handlers below cover the
  // window when signals arrive before Nest is fully wired.
  app.enableShutdownHooks();

  const shutdownGraceMs = envService.getNumber('SHUTDOWN_GRACE_MS', 30_000);
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal} — starting graceful shutdown (grace: ${shutdownGraceMs}ms)`, 'Bootstrap');
    const deadline = setTimeout(() => {
      logger.error(
        `Shutdown grace period (${shutdownGraceMs}ms) elapsed — forcing exit. ` +
          'In-flight requests may have been dropped.',
        undefined,
        'Bootstrap',
      );
      process.exit(1);
    }, shutdownGraceMs);
    deadline.unref();
    try {
      await app.close();
      logger.log('Graceful shutdown complete', 'Bootstrap');
      process.exit(0);
    } catch (err) {
      logger.error(
        `app.close() failed during shutdown: ${(err as Error).message}`,
        (err as Error).stack,
        'Bootstrap',
      );
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Refuse to boot in prod with the .env.example placeholder.
  envService.assertProductionSecretsSafe();

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Performance: gzip/deflate compression. Same defaults as apps/api.
  app.use(compression({ threshold: 1024, level: 6 }));

  // Helmet — the facade is internal-only so CORS is permissive in
  // non-prod and locked in prod. CSP is omitted because the surface
  // is JSON + problem+json only.
  const isProd = envService.isProduction();
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: false,
      hsts: isProd
        ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' },
      noSniff: true,
      xssFilter: true,
    }),
  );

  app.enableCors({
    origin: envService.getCorsOrigins(),
    credentials: false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Webhook-Signature'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  // Global class-validator pipe for any DTOs that use class-validator
  // decorators. Zod schemas use the per-route ZodValidationPipe.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger UI at /docs (no prefix), only in non-prod.
  if (!isProd) {
    setupSwagger(app);
  }

  const port = envService.getNumber('LOGISTICS_FACADE_PORT', 4100);
  await app.listen(port);

  logger.log(`Logistics facade running on port ${port}`, 'Bootstrap');
  if (!isProd) {
    logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
  }
}

bootstrap();
