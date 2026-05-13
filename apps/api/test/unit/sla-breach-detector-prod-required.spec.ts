import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.2) — `SLA_BREACH_DETECTOR_ENABLED` must be true in prod.
 *
 * The cron (`SlaBreachDetectorCron`, instrumented in PR 5.2) walks
 * non-terminal returns / disputes / tickets every 5 minutes, asks
 * the SLA tracker for a verdict, opens / escalates / resolves breach
 * rows, and emits `sla.breached` events. The flag gates the whole
 * cron body — off means stuck cases sit unflagged.
 *
 * Stays off in dev/test/staging so:
 *   - CI runs don't fire escalations across pristine fixtures.
 *   - Staging environments with stale data don't page on-call.
 *
 * Production must explicitly opt in. The supporting infrastructure
 * (`SlaPolicy` seed rows + `sla.breached` event handlers) is the
 * operator's responsibility; the flag is the boot-time forcing
 * function that surfaces "you deployed the SLA cron but forgot to
 * enable it" before customer cases pile up.
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
  RAZORPAY_KEY_ID: 'x',
  RAZORPAY_KEY_SECRET: 'x',
  RAZORPAY_WEBHOOK_SECRET: 'x',
  S3_BUCKET: 'x',
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY: 'x',
  S3_SECRET_KEY: 'x',
  ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
  CORS_ORIGINS: 'https://app.example.com',
  // Sibling required-on flags (PR 6.1, 6.3 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
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

describe('SLA_BREACH_DETECTOR_ENABLED prod policy (PR 6.2)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.SLA_BREACH_DETECTOR_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        SLA_BREACH_DETECTOR_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where SLA_BREACH_DETECTOR_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/SLA_BREACH_DETECTOR_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        SLA_BREACH_DETECTOR_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        SLA_BREACH_DETECTOR_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('the existing CRON_HEARTBEAT_ENABLED prod check still fires independently', () => {
      // Defensive: adding the new flag must not weaken the prior one.
      // Test a prod env with SLA_BREACH true but CRON_HEARTBEAT false
      // — should still reject for the cron-heartbeat reason.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        SLA_BREACH_DETECTOR_ENABLED: 'true',
        CRON_HEARTBEAT_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('CRON_HEARTBEAT_ENABLED');
      }
    });
  });
});
