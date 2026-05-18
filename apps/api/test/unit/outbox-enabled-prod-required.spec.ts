import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.9) — `OUTBOX_ENABLED` must be true in prod.
 *
 * `OUTBOX_ENABLED` runs the publisher worker that drains `outbox_events`
 * rows on a 1s poll. The outbox itself was built (ADR-008) to close the
 * crash-loss window between "EventBus emitted in-process" and "every
 * handler finished" — without a durable queue, a process restart drops
 * every event that the publisher hadn't fanned out yet.
 *
 * Off in prod, the worker doesn't run. Two failure modes depending on
 * what else is configured:
 *
 *   - With `OUTBOX_DUAL_WRITE=true`: every event lands in the outbox
 *     transactionally AND fires in-process. The in-process path
 *     delivers normally, but the outbox table grows unbounded and the
 *     crash-safety guarantee is gone — a restart at the wrong moment
 *     loses every in-flight handler.
 *
 *   - With `OUTBOX_AUTHORITATIVE=true`: events go to the outbox only,
 *     nothing fans out, every event is silently dropped. (The existing
 *     `OUTBOX_AUTHORITATIVE → OUTBOX_ENABLED` interlock at the env
 *     schema's `superRefine` already prevents this combination, but
 *     the prod-required check is the boot-time forcing function that
 *     keeps the publisher running even before the cutover.)
 *
 * Stays off in dev / test / staging because the publisher polls
 * Postgres every 1s; CI runs and local development don't need it.
 * Note that this flag alone doesn't enforce that the outbox is in
 * the write path — that's `OUTBOX_DUAL_WRITE` (a follow-up PR
 * candidate). 6.9 ensures the publisher is at least running so that
 * an operator flipping `OUTBOX_DUAL_WRITE` doesn't have a "first
 * batch sits orphaned" gap.
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
  // Sibling required-on flags (PR 6.1 – 6.8, 6.10 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
  ERASURE_PROCESSOR_ENABLED: 'true',
  WALLET_LEDGER_RECON_ENABLED: 'true',
  EVENT_DEDUP_ENABLED: 'true',
  OUTBOX_DUAL_WRITE: 'true',
  REFUND_GATEWAY_RECON_ENABLED: 'true',
  RETENTION_ENFORCER_ENABLED: 'true',
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('OUTBOX_ENABLED prod policy (PR 6.9)', () => {
  describe('dev / staging — flag default-on (Phase 10 — promoted from off in 2026-05-16)', () => {
    it('dev parses cleanly with the flag absent and inherits the default-on', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.OUTBOX_ENABLED).toBe('true');
    });

    it('staging accepts the flag explicitly off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        OUTBOX_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('accepts a prod env where OUTBOX_ENABLED is missing (inherits default-on)', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(true);
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the publisher / crash-loss / drain framing so the boot trace explains the ADR-008 intent', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/publisher|outbox|crash|drain|ADR-008/i);
      }
    });

    it('the existing OUTBOX_AUTHORITATIVE → OUTBOX_ENABLED interlock keeps firing alongside the new prod gate', () => {
      // The Phase 2 interlock (lines 503-509 of env.schema.ts) raises
      // an issue with path ['OUTBOX_AUTHORITATIVE'] when AUTHORITATIVE
      // is on but ENABLED is off. The new prod rule raises an issue
      // with path ['OUTBOX_ENABLED']. Together: setting AUTHORITATIVE
      // without ENABLED in prod must produce BOTH paths' errors so
      // operators see the full picture in one boot failure.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_AUTHORITATIVE: 'true',
        OUTBOX_DUAL_WRITE: 'true',
        OUTBOX_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('OUTBOX_ENABLED');
        expect(paths).toContain('OUTBOX_AUTHORITATIVE');
      }
    });

    it('sibling required-on flags still fire independently when only OUTBOX_ENABLED is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_ENABLED: 'true',
        EVENT_DEDUP_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('EVENT_DEDUP_ENABLED');
      }
    });
  });
});
