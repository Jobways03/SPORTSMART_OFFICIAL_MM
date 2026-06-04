import { z } from 'zod';

/**
 * Zod schema for environment variables. Parsed once on boot in
 * EnvService — invalid env crashes the process with a useful error
 * before any module ticks. Mirrors apps/api/src/bootstrap/env/env.schema.ts
 * at a smaller scope.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),

  LOGISTICS_FACADE_PORT: z.coerce.number().int().positive().default(4100),
  /// Graceful-shutdown deadline in ms. Matches K8s' default
  /// terminationGracePeriodSeconds.
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(30_000),

  APP_NAME: z.string().default('sportsmart-logistics-facade'),
  CORS_ORIGINS: z.string().default('http://localhost:4005,http://localhost:8000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'verbose']).default('info'),

  // Storage
  LOGISTICS_DATABASE_URL: z.string().min(1),
  LOGISTICS_REDIS_URL: z.string().min(1),

  // Inter-service auth. M0 is a single shared secret; M1 replaces
  // this with a per-caller ApiKey table backed by hashed tokens
  // (mirrors apps/api/src/core/api-keys/).
  INTERNAL_API_KEY: z.string().min(32),

  // Tracing (optional — see bootstrap/tracing/tracing.ts).
  OTEL_ENABLED: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
