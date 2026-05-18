import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.11) — `REFUND_GATEWAY_RECON_ENABLED` must be true in prod.
 *
 * Every Razorpay refund creates a `RefundInstruction` row in PROCESSING
 * with a `gatewayRefundId` set, and we depend on Razorpay's webhook to
 * tell us when the bank actually settled. Webhooks are not reliable: a
 * 500 / network blip / outbound IP-allowlist mismatch / a brief restart
 * window all consume Razorpay's retry budget, and after that, the
 * gateway's notification never arrives — even though the refund itself
 * processed cleanly.
 *
 * `RefundGatewayReconCron` is the safety net. Every hour it scans
 * PROCESSING instructions older than 24h with a `gatewayRefundId`,
 * (the follow-up PR will GET against Razorpay's refund endpoint and
 * close them out; today it emits `refund.gateway.stuck` so ops sees
 * the stuck row). Off in prod, the safety net is gone: refunds stay
 * stuck indefinitely, customers escalate via support ("I asked for a
 * refund 3 days ago"), and the only signal we have is human pressure.
 *
 * Stays off in dev/test/staging because real Razorpay refunds aren't
 * landing in fixtures; the 24h-stuck threshold against fresh seed
 * data would never trip, and CI doesn't want background timers.
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
  // Sibling required-on flags (PR 6.1 – 6.10, 6.12 – 6.15).
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
  RETENTION_ENFORCER_ENABLED: 'true',
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('REFUND_GATEWAY_RECON_ENABLED prod policy (PR 6.11)', () => {
  describe('dev / staging — flag default-on (Phase 9 — promoted from off in 2026-05-16)', () => {
    it('dev parses cleanly with the flag absent and inherits the default-on', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.REFUND_GATEWAY_RECON_ENABLED).toBe('true');
    });

    it('staging accepts the flag explicitly off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        REFUND_GATEWAY_RECON_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('accepts a prod env where REFUND_GATEWAY_RECON_ENABLED is missing (inherits default-on)', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(true);
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_GATEWAY_RECON_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_GATEWAY_RECON_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the webhook-drop / stuck-refund framing so the boot trace explains the safety-net intent', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_GATEWAY_RECON_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/webhook|stuck|refund|reconcil|Razorpay/i);
      }
    });

    it('sibling required-on flags still fire independently when only refund-recon is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_GATEWAY_RECON_ENABLED: 'true',
        OUTBOX_DUAL_WRITE: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('OUTBOX_DUAL_WRITE');
      }
    });
  });
});
