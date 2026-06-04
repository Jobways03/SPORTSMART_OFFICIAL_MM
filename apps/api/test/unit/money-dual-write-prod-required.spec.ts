import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 7 (PR 7.1) — `MONEY_DUAL_WRITE_ENABLED` must be true in prod.
 *
 * ADR-007 (paise migration) plans a five-step rollout:
 *
 *   1. Add `*_in_paise` BIGINT columns alongside every Decimal money
 *      column. (Schema migrations — done.)
 *   2. Dual-write: every service that mutates a Decimal money column
 *      also computes the paise sibling via MoneyDualWriteHelper and
 *      writes both transactionally. (This PR.)
 *   3. Backfill: a one-off job walks historical rows and populates
 *      paise siblings from the existing Decimal values.
 *   4. Read-switch: callers start reading paise siblings as the
 *      source of truth; the Decimal becomes the legacy mirror.
 *   5. Cutover: drop the Decimal columns; paise is the only source.
 *
 * Step 2 is the load-bearing one for prod: it is the only place that
 * keeps the two columns in sync going forward. The backfill in step 3
 * is a one-shot operation against the historical tail; if step 2 is
 * off in prod, new writes drift away from each other and the backfill
 * has to be re-run repeatedly. By the time step 4 lands, the only
 * defensible posture is "every prod write has been dual-writing for
 * the full retention window of any rows the read-switch will touch."
 *
 * The MoneyDualWriteHelper no-ops at the flag-OFF setting and at the
 * call sites where the model isn't in MONEY_FIELD_REGISTRY — so this
 * gate is safe to flip even mid-migration: it forces the apparatus
 * on without forcing every model to be wired. The remaining wiring
 * is a per-call-site rollout, not gated by this env var.
 *
 * Stays off in dev / test / staging because:
 *   - CI fixtures fill the Decimal columns by hand; the helper would
 *     also compute paise and surface schema-shape assertions in
 *     existing tests that don't know about paise yet.
 *   - Local migration testing is easier when the dual-write path can
 *     be toggled on per-test rather than globally enabled.
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
  R2_ACCOUNT_ID: 'x',
  R2_BUCKET: 'media',
  R2_ACCESS_KEY_ID: 'x',
  R2_SECRET_ACCESS_KEY: 'x',
  ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
  APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
  // Sibling required-on flags (Phase 6 — PRs 6.1 – 6.15).
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
  COD_REFUND_PENDING_ENABLED: 'true',
};

describe('MONEY_DUAL_WRITE_ENABLED prod policy (PR 7.1)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.MONEY_DUAL_WRITE_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        MONEY_DUAL_WRITE_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });

    it('dev also accepts the flag on for local migration testing', () => {
      // The gate is "prod requires on", not "non-prod requires off".
      // A developer might enable dual-write locally to validate that
      // a new service wires through the helper correctly.
      const result = envSchema.safeParse({
        ...baseDevEnv,
        MONEY_DUAL_WRITE_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where MONEY_DUAL_WRITE_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/MONEY_DUAL_WRITE_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        MONEY_DUAL_WRITE_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        MONEY_DUAL_WRITE_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the ADR-007 / paise / dual-write / drift framing so the boot trace explains the migration intent', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/ADR-007|paise|dual-write|drift|migration/i);
      }
    });

    it('Phase 6 sibling required-on flags still fire independently when only the dual-write flag is set', () => {
      // Defensive: the Phase 7 gate must not weaken the Phase 6 gates.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        MONEY_DUAL_WRITE_ENABLED: 'true',
        COD_REFUND_PENDING_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('COD_REFUND_PENDING_ENABLED');
      }
    });
  });
});
