import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.1) — `CRON_HEARTBEAT_ENABLED` must be true in prod.
 *
 * Backstory: PRs 5.1–5.5 built the full cron-observability stack —
 * every @Cron service is instrumented, `cron_runs` records each
 * tick, `cron_heartbeat_targets` is seeded with the expected
 * intervals. The heartbeat-detector cron (`CronHeartbeatCron`) walks
 * those targets and emits `cron.silent` for any job whose last
 * SUCCEEDED run is older than its tolerance.
 *
 * Without `CRON_HEARTBEAT_ENABLED=true`, the detector early-returns
 * and the whole pipeline is silently inert. A cron that stops firing
 * in production stays dark until a customer complaint surfaces it —
 * which defeats the point of every PR-5.* investment.
 *
 * The flag stays default-false in dev/test/staging so:
 *   - Test suites don't emit `cron.silent` events when crons aren't
 *     actually running between assertions.
 *   - A dev box without a populated `cron_heartbeat_targets` table
 *     doesn't get noisy.
 *
 * Production must explicitly set `CRON_HEARTBEAT_ENABLED=true` —
 * caught at boot if missed.
 */

const SECRETS = {
  JWT_CUSTOMER_SECRET: 'c'.repeat(32),
  JWT_SELLER_SECRET: 's'.repeat(32),
  JWT_FRANCHISE_SECRET: 'f'.repeat(32),
  JWT_ADMIN_SECRET: 'a'.repeat(32),
  JWT_AFFILIATE_SECRET: 'p'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
  AFFILIATE_ENCRYPTION_KEY: 'k'.repeat(32),
};

const baseDevEnv = {
  NODE_ENV: 'development' as const,
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  ...SECRETS,
};

const baseProdEnv = {
  ...baseDevEnv,
  NODE_ENV: 'production' as const,
  // Pre-existing required-in-prod stubs so we can isolate the
  // cron-heartbeat assertion below.
  RAZORPAY_KEY_ID: 'x',
  RAZORPAY_KEY_SECRET: 'x',
  RAZORPAY_WEBHOOK_SECRET: 'x',
  S3_BUCKET: 'x',
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY: 'x',
  S3_SECRET_KEY: 'x',
  ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
  APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
  // Phase 6 — sibling prod-flag gates; this spec tests the
  // cron-heartbeat policy in isolation, so pre-satisfy the others.
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
  ERASURE_PROCESSOR_ENABLED: 'true',
  WALLET_LEDGER_RECON_ENABLED: 'true',
  EVENT_DEDUP_ENABLED: 'true',
  OUTBOX_ENABLED: 'true',
  OUTBOX_DUAL_WRITE: 'true',
  REFUND_GATEWAY_RECON_ENABLED: 'true',
  RETENTION_ENFORCER_ENABLED: 'true',
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('CRON_HEARTBEAT_ENABLED prod policy (PR 6.1)', () => {
  describe('dev / test / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.CRON_HEARTBEAT_ENABLED).toBe('false');
    });

    it('dev accepts explicit CRON_HEARTBEAT_ENABLED=false', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        CRON_HEARTBEAT_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        CRON_HEARTBEAT_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where CRON_HEARTBEAT_ENABLED is missing (defaults to false)', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/CRON_HEARTBEAT_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CRON_HEARTBEAT_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CRON_HEARTBEAT_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error message names the flag exactly so ops can fix it from boot logs', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('CRON_HEARTBEAT_ENABLED');
      }
    });
  });
});
