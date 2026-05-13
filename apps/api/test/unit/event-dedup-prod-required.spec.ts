import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.8) — `EVENT_DEDUP_ENABLED` must be true in prod.
 *
 * The outbox publisher is at-least-once by design (ADR-008). The
 * `EventDeduplicationService.tryConsume` claim — an atomic INSERT
 * into `event_deduplication` keyed on (eventId, handlerName), with
 * P2002 = "already consumed, skip" — is what converts at-least-once
 * delivery into effective exactly-once at the handler boundary.
 *
 * At flag-OFF, `tryConsume` short-circuits and returns true for every
 * call. A publisher restart mid-batch, a transient consumer crash, or
 * a manual operator "replay this event" then re-fires every handler
 * for every re-delivered event. The blast radius differs per handler:
 *
 *   - Notification handlers (email/SMS/Slack/WhatsApp on order-confirmed,
 *     dispute-opened, refund-issued): customer receives N copies, ops
 *     receives N pages.
 *   - Audit-log handlers: duplicate rows pollute the tamper-evidence
 *     chain that PR 6.3 (audit anchor) is supposed to protect.
 *   - Commission accrual: depends on the next-layer CAS to save us —
 *     when the CAS has a bug, dedup is the second line of defence.
 *   - Wallet drift event handler: double-pages finance, drowns the
 *     real signal.
 *
 * Stays off in dev/test/staging because the dedup table is per-row
 * INSERT-on-consume; test fixtures that fire the same event from
 * multiple test cases would collide on the synthetic id.
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
  // Sibling required-on flags (PR 6.1 – 6.7, 6.9 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
  ERASURE_PROCESSOR_ENABLED: 'true',
  WALLET_LEDGER_RECON_ENABLED: 'true',
  OUTBOX_ENABLED: 'true',
  OUTBOX_DUAL_WRITE: 'true',
  REFUND_GATEWAY_RECON_ENABLED: 'true',
  RETENTION_ENFORCER_ENABLED: 'true',
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('EVENT_DEDUP_ENABLED prod policy (PR 6.8)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.EVENT_DEDUP_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        EVENT_DEDUP_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where EVENT_DEDUP_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/EVENT_DEDUP_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        EVENT_DEDUP_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        EVENT_DEDUP_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the at-least-once / exactly-once / replay framing so the boot trace explains the delivery-semantics intent', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/at-least-once|exactly-once|replay|dedup|duplicate/i);
      }
    });

    it('sibling required-on flags still fire independently when only event-dedup is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        EVENT_DEDUP_ENABLED: 'true',
        WALLET_LEDGER_RECON_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('WALLET_LEDGER_RECON_ENABLED');
      }
    });
  });
});
