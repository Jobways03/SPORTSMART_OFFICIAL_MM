// Phase 11 (2026-05-16) — OpenTelemetry MUST initialize before
// any other import so the SDK can patch the Node module loader
// before Express/Prisma/Redis get cached. No-op when
// OTEL_ENABLED!=true or the packages aren't installed; see
// tracing/tracing.ts for the lazy-require + install instructions.
import { initTracing } from './bootstrap/tracing/tracing';
initTracing();

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';

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

  // Phase 10 (2026-05-16) — Graceful shutdown.
  //
  // enableShutdownHooks() makes Nest call onModuleDestroy on every
  // provider when the process receives SIGTERM/SIGINT. Without it,
  // a pod eviction (kubectl rollout, autoscaler scale-down) hard-
  // kills the process and:
  //   • in-flight HTTP requests are dropped mid-response — paid
  //     customers see a 502 with no idempotency guarantee
  //   • the outbox tick that's mid-publish leaks its lock for TTL
  //     and may double-emit when the next replica grabs the row
  //   • setInterval-based crons are torn down without their
  //     `onModuleDestroy` releasing handles
  //
  // Nest's app.close() under enableShutdownHooks:
  //   1. Stops accepting new HTTP connections (the listener closes).
  //   2. Calls every provider's onModuleDestroy in reverse-init order.
  //   3. Drains in-flight handlers (the underlying http server has
  //      its own grace period — see SHUTDOWN_GRACE_MS below).
  //   4. Exits when the queue is empty.
  app.enableShutdownHooks();

  // Belt + braces: explicit handlers for SIGTERM/SIGINT that call
  // app.close() with a hard deadline. Nest's hook usually fires
  // first, but in some container runtimes the signal arrives before
  // Nest is fully wired — these handlers cover that window.
  const shutdownGraceMs = envService.getNumber('SHUTDOWN_GRACE_MS', 30_000);
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal} — starting graceful shutdown (grace: ${shutdownGraceMs}ms)`, 'Bootstrap');
    const deadline = setTimeout(() => {
      logger.error(
        `Shutdown grace period (${shutdownGraceMs}ms) elapsed — forcing exit. ` +
          'In-flight requests may have been dropped; investigate which provider failed to release in onModuleDestroy.',
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

  // Follow-up #H40 — parse incoming Cookie headers into req.cookies so
  // auth guards can read tokens from httpOnly cookies set on login.
  // Cookies are set/cleared via core/auth/auth-cookie.helper.ts which
  // mirrors the same Secure + SameSite=Lax + Domain config across
  // every persona's login + refresh + logout route. Bearer-header
  // auth still works in parallel during the frontend migration.
  app.use(cookieParser());

  // ── Security headers (helmet) ──
  // CSP is intentionally tight for an API; Swagger UI in non-prod relaxes it.
  const isProd = envService.isProduction();
  const isStaging = envService.getString('NODE_ENV') === 'staging';
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: isProd
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              // Phase 13 (2026-05-16) — dropped 'unsafe-inline' from
              // styleSrc. The API returns JSON, problem+json, and the
              // small set of HTML error pages — none of which need
              // inline `<style>` blocks. Keeping 'unsafe-inline' on a
              // CSP that otherwise locks down scripts undermines the
              // protection: a stylesheet injection can rewrite the
              // visual hierarchy (button labels swapped on phishing
              // pages, copy-paste of fake admin warnings).
              styleSrc: ["'self'"],
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
      // Phase 13 (2026-05-16) — HSTS in production AND staging.
      // Staging runs over HTTPS in our deployment topology, so a
      // downgrade attack there is just as dangerous as in prod (a
      // tester logging in over a stripped HTTP staging URL would
      // leak their JWT). Dev keeps HSTS off because local dev runs
      // HTTP on localhost and HSTS would pin the certificate for
      // every developer's browser.
      hsts: (isProd || isStaging)
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
