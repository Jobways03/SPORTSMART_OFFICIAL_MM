import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.15) — `COD_REFUND_PENDING_ENABLED` must be true in prod.
 *
 * COD orders refund via bank transfer / UPI rather than reversing the
 * original payment gateway (there was no gateway charge). The refund
 * instruction enters `MANUAL_REQUIRED` and stays there until finance
 * wires the money externally and confirms.
 *
 * `CodRefundPendingCron` runs every 4h, finds `MANUAL_REQUIRED`
 * instructions older than `COD_REFUND_PENDING_STUCK_HOURS` (default
 * 48h), emits `refund.cod.pending_aged` per row, and logs the total
 * MANUAL_REQUIRED count for the dashboard gauge.
 *
 * Off in prod, the queue is invisible from the engineering side.
 * Finance discovers stuck COD refunds via customer escalation only
 * — same failure mode as PR 6.11's refund-gateway recon, but for the
 * out-of-band rail. Pairs with 6.11 to cover both refund channels:
 *
 *   - PR 6.11: gateway refunds whose webhook never landed.
 *   - PR 6.15: COD refunds whose manual wire-out never landed.
 *
 * Stays off in dev/test/staging because the 48h-stuck threshold
 * against fixture data never trips, and the cron's background
 * timer is unwanted in CI.
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
  APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
  // Sibling required-on flags (PR 6.1 – 6.14).
  CRON_HEARTBEAT_ENABLED: 'true',
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
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('COD_REFUND_PENDING_ENABLED prod policy (PR 6.15)', () => {
  describe('dev / staging — flag default-on (Phase 9 — promoted from off in 2026-05-16)', () => {
    it('dev parses cleanly with the flag absent and inherits the default-on', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.COD_REFUND_PENDING_ENABLED).toBe('true');
    });

    it('staging accepts the flag explicitly off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        COD_REFUND_PENDING_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('accepts a prod env where COD_REFUND_PENDING_ENABLED is missing (inherits default-on)', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(true);
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        COD_REFUND_PENDING_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        COD_REFUND_PENDING_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the COD / MANUAL_REQUIRED / aged-pending framing so the boot trace explains the off-rail-refund concern', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        COD_REFUND_PENDING_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/COD|MANUAL_REQUIRED|manual wire|out-of-band|aged|finance/i);
      }
    });

    it('the paired PR-6.11 refund-gateway gate still fires independently when only COD is set', () => {
      // PR 6.11 + PR 6.15 together cover both refund rails. Setting
      // only one must still surface the other's prod-required error.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        COD_REFUND_PENDING_ENABLED: 'true',
        REFUND_GATEWAY_RECON_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('REFUND_GATEWAY_RECON_ENABLED');
      }
    });
  });
});
