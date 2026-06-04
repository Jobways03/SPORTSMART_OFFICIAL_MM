import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.4) — `IDEMPOTENCY_ENABLED` must be true in prod.
 *
 * The `IdempotencyInterceptor` short-circuits when the flag is false:
 * @Idempotent() handlers behave like plain POSTs, the `X-Idempotency-Key`
 * header is ignored, and no row is written to `idempotency_keys`. That
 * is the right behaviour for dev/test/CI (fixtures stay clean, integration
 * tests don't need to forge fresh keys per case).
 *
 * In production the same default is dangerous:
 *
 *   1. `POST /payments` (Razorpay capture) — a retry-on-timeout from the
 *      mobile app double-charges the customer.
 *   2. `POST /wallet/credits` & wallet adjustments — replay of an admin
 *      action double-credits the wallet.
 *   3. `POST /returns/:id/approve` and `POST /refunds` — a hung admin
 *      tab refresh triggers two refund instructions for the same return.
 *   4. `POST /payouts` — duplicate seller payouts.
 *   5. `POST /disputes` (open / mirror) — duplicate disputes confuse
 *      both the customer-side ledger and the support queue.
 *
 * Every one of those endpoints is decorated `@Idempotent()` today. The
 * flag is the boot gate that turns the decorator from advisory to load-
 * bearing.
 *
 * Pattern matches PR 6.1 / 6.2 / 6.3: dev/staging keep the default-off
 * for ergonomics, prod refuses to start without explicit opt-in.
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
  // Sibling required-on flags (PR 6.1 – 6.3, 6.5 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
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

describe('IDEMPOTENCY_ENABLED prod policy (PR 6.4)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.IDEMPOTENCY_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        IDEMPOTENCY_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where IDEMPOTENCY_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/IDEMPOTENCY_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        IDEMPOTENCY_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        IDEMPOTENCY_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the duplicate-charge / replay risk so ops reads intent from the boot trace', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        // Keyword from the policy reason text — stable grep target
        // for the runbook.
        expect(messages).toMatch(/duplicate|replay|retry/i);
      }
    });

    it('sibling required-on flags still fire independently when only IDEMPOTENCY is set', () => {
      // Defensive: if the audit-chain or SLA flag is off, the new
      // idempotency entry must not mask the others' errors.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        IDEMPOTENCY_ENABLED: 'true',
        AUDIT_CHAIN_ANCHOR_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('AUDIT_CHAIN_ANCHOR_ENABLED');
      }
    });
  });
});
