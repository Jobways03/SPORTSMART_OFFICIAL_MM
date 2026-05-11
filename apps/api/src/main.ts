import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as compression from 'compression';

import { AppModule } from './app.module';
import { EnvService } from './bootstrap/env/env.service';
import { AppLoggerService } from './bootstrap/logging/app-logger.service';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter';
import { setupSwagger } from './bootstrap/docs/swagger.module';

// Phase 1.4 (ADR-007) — BigInt JSON serialisation. The new *_in_paise
// columns are BigInt in Prisma; JSON.stringify on a BigInt throws
// (`Do not know how to serialize a BigInt`) by default. Serialising as
// a string keeps full precision — paise totals can exceed
// Number.MAX_SAFE_INTEGER for platform-level rollups — and matches the
// wire format every paise API in the wild uses (Stripe, Razorpay).
// Clients that need numeric arithmetic should `BigInt(value)` on read.
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

  // Phase 4 (PR 4.6) — refuse to boot in production with placeholder
  // JWT secrets from .env.example. Cheap, surface-level safety net.
  envService.assertProductionSecretsSafe();

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

  // ── Security headers (helmet) ──
  // CSP is intentionally tight for an API; Swagger UI in non-prod relaxes it.
  const isProd = envService.isProduction();
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: isProd
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", 'data:'],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
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
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
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

  // Pass EnvService so the filter can flip between legacy and RFC 7807
  // (PROBLEM_DETAILS_ENABLED). Filter degrades gracefully if envService
  // is undefined (e.g. in tests that instantiate it directly).
  app.useGlobalFilters(new GlobalExceptionFilter(logger, envService));

  if (!envService.isProduction()) {
    setupSwagger(app);
  }

  const port = envService.getNumber('PORT', 8000);

  await app.listen(port);

  logger.log(`API server running on port ${port}`, 'Bootstrap');
  if (!envService.isProduction()) {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
  }

  // Phase 4 (PR 4.6) — authz mode banner. Operators reading the boot
  // log need to know which mode strict/soak/audit flags are in WITHOUT
  // having to read .env. Single grep-friendly line per flag.
  const strict = envService.getBoolean('PERMISSIONS_GUARD_STRICT', false);
  const abac = envService.getBoolean('ABAC_ENABLED', false);
  const audit = envService.getBoolean('AUTHZ_AUDIT_ENABLED', true);
  logger.log(
    `Authorization | PERMISSIONS_GUARD_STRICT=${strict} ABAC_ENABLED=${abac} AUTHZ_AUDIT_ENABLED=${audit}`,
    'Bootstrap',
  );
  if (!strict) {
    logger.warn(
      'PERMISSIONS_GUARD_STRICT=false — running in SOAK mode. ' +
        'Failed permission checks are logged (event=authz.deny) but allowed through. ' +
        'Flip to true once /admin/authz/readiness reports zero false-positive denies.',
      'Bootstrap',
    );
  }
}

bootstrap();
