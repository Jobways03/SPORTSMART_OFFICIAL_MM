import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 3 (PR 3.3) — JWT access-token TTL policy.
 *
 * Pre-PR the access-token TTL defaulted to 7 days. A stolen access
 * token was valid for a week against every endpoint protected by a
 * guard — even after the legitimate user logged out from a different
 * device (the per-session revocation check helps, but only for the
 * device the user logged out from; other devices' sessions stay
 * "fresh" for the remaining TTL).
 *
 * PR 3.3 tightens the default to 1h. The refresh-token rotation flow
 * (PR 3.2, now with hashed storage) is the supported way to extend a
 * working session past 1h. Clients without proper 401→refresh
 * handling will see hourly re-logins; clients with refresh handling
 * are unaffected.
 *
 * Cross-field invariants (validated at schema parse time):
 *
 *   1. JWT_REFRESH_TTL must be parseable to a duration > 0.
 *   2. JWT_ACCESS_TTL must be parseable to a duration > 0.
 *   3. JWT_REFRESH_TTL > JWT_ACCESS_TTL (refresh has no purpose if it
 *      expires before the access token it's meant to rotate).
 *   4. In production, JWT_ACCESS_TTL <= 24h (an explicit env-level
 *      backstop against operators reverting to a multi-day default).
 */

const baseDevEnv = {
  NODE_ENV: 'development' as const,
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  // Phase 3 (PR 3.5) — distinct values per JWT secret to satisfy the
  // pairwise-uniqueness invariant. The schema now rejects fixtures that
  // share a single value across actor scopes.
  JWT_CUSTOMER_SECRET: 'c'.repeat(32),
  JWT_SELLER_SECRET: 's'.repeat(32),
  JWT_FRANCHISE_SECRET: 'f'.repeat(32),
  JWT_ADMIN_SECRET: 'a'.repeat(32),
  JWT_AFFILIATE_SECRET: 'p'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
  AFFILIATE_ENCRYPTION_KEY: 'k'.repeat(32),
};

describe('JWT TTL policy (PR 3.3)', () => {
  describe('schema defaults', () => {
    it('JWT_ACCESS_TTL defaults to 1h (down from the pre-PR 7d)', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.JWT_ACCESS_TTL).toBe('1h');
    });

    it('JWT_REFRESH_TTL still defaults to 30d', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.JWT_REFRESH_TTL).toBe('30d');
    });
  });

  describe('cross-field validation', () => {
    it('rejects an env where REFRESH_TTL is shorter than ACCESS_TTL', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        JWT_ACCESS_TTL: '2h',
        JWT_REFRESH_TTL: '1h',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/JWT_REFRESH_TTL.*greater.*JWT_ACCESS_TTL/i);
      }
    });

    it('rejects an env where ACCESS_TTL is unparseable garbage', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        JWT_ACCESS_TTL: 'not-a-duration',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an env where REFRESH_TTL is zero or negative', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        JWT_REFRESH_TTL: '0d',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a sane prod env (ACCESS=1h, REFRESH=30d)', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'production',
        // Satisfy the prod-only required-set so we can isolate the TTL
        // policy check.
        RAZORPAY_KEY_ID: 'x',
        RAZORPAY_KEY_SECRET: 'x',
        RAZORPAY_WEBHOOK_SECRET: 'x',
        S3_BUCKET: 'x',
        S3_REGION: 'ap-south-1',
        S3_ACCESS_KEY: 'x',
        S3_SECRET_KEY: 'x',
        ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
        // Phase 3 (PR 3.7) — explicit https origin required in prod.
        APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
        // Phase 6 — required-on-in-prod flags.
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
        MONEY_DUAL_WRITE_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production-only hardening', () => {
    const baseProdEnv = {
      ...baseDevEnv,
      NODE_ENV: 'production' as const,
      // Required-in-prod stubs (PR pre-existing) so we can isolate
      // the TTL assertion below.
      RAZORPAY_KEY_ID: 'x',
      RAZORPAY_KEY_SECRET: 'x',
      RAZORPAY_WEBHOOK_SECRET: 'x',
      S3_BUCKET: 'x',
      S3_REGION: 'ap-south-1',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'x',
      ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
      // Phase 6 — required-on-in-prod flags.
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
      MONEY_DUAL_WRITE_ENABLED: 'true',
      // Phase 3 (PR 3.7) — explicit https origin required in prod.
      APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
    };

    it('rejects a prod env with ACCESS_TTL > 24h', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        JWT_ACCESS_TTL: '7d',
        JWT_REFRESH_TTL: '30d',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/JWT_ACCESS_TTL.*24h.*production/i);
      }
    });

    it('accepts a prod env with ACCESS_TTL = 24h (boundary)', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        JWT_ACCESS_TTL: '24h',
        JWT_REFRESH_TTL: '30d',
      });
      expect(result.success).toBe(true);
    });

    it('does NOT enforce the 24h cap in dev/staging', () => {
      const dev = envSchema.safeParse({
        ...baseDevEnv,
        JWT_ACCESS_TTL: '7d',
      });
      expect(dev.success).toBe(true);
      const staging = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        JWT_ACCESS_TTL: '7d',
      });
      expect(staging.success).toBe(true);
    });
  });
});
