import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 3 (PR 3.7) — CORS_ORIGINS production policy.
 *
 * Pre-PR the env schema accepted any string for `CORS_ORIGINS`. In
 * combination with `app.enableCors({ credentials: true })`, that left
 * two foot-guns wide open:
 *
 *   1. `*` (wildcard) origin: a misconfigured prod that defaults to
 *      "allow everyone" will happily accept session cookies and
 *      Bearer tokens from any site visited by the user. Classic
 *      credential-exfiltration setup.
 *
 *   2. `http://...` (cleartext) origin in prod: a CDN proxy bug that
 *      strips TLS no longer trips a guard.
 *
 *   3. Malformed entries (`https//evil.com`, embedded whitespace,
 *      stray semicolons): silently land in the allow-list and behave
 *      as catch-all wildcards in `enableCors` depending on Express's
 *      string-vs-regex matcher.
 *
 * The schema-level check below catches all three at boot. Dev / test
 * / staging keep the loose rules so localhost continues to work.
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
  // Required-in-prod stubs (added in earlier PRs) so we can isolate
  // the CORS check below.
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
  // Phase 7 — Paise migration prod-required flags.
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('CORS_ORIGINS production policy (PR 3.7)', () => {
  describe('dev / test / staging — keep the loose default', () => {
    it('localhost http origin is fine in dev', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        CORS_ORIGINS: 'http://localhost:4005',
      });
      expect(result.success).toBe(true);
    });

    it('wildcard origin is allowed in dev (sometimes useful for local debugging)', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(true);
    });

    it('wildcard origin is allowed in staging', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — strict', () => {
    it('rejects a wildcard origin in production', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/CORS_ORIGINS.*wildcard.*production/i);
      }
    });

    it('rejects a cleartext http:// origin in production', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS: 'http://sportsmart.example.com',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/CORS_ORIGINS.*https/i);
      }
    });

    it('rejects a malformed origin (missing scheme separator)', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS: 'https//sportsmart.example.com',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a single well-formed https origin', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS: 'https://app.sportsmart.example.com',
      });
      expect(result.success).toBe(true);
    });

    it('accepts multiple https origins separated by commas (whitespace tolerated)', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS:
          'https://app.sportsmart.example.com, https://admin.sportsmart.example.com',
      });
      expect(result.success).toBe(true);
    });

    it('rejects when ANY entry in a comma list is bad — fail closed for the whole list', () => {
      // A typo in one entry must not silently land an attacker-controlled
      // origin in the allow list. Reject the whole string and force the
      // operator to fix every entry.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS:
          'https://app.sportsmart.example.com,http://internal-debug.example.com',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty CORS_ORIGINS in production (no allow-list ⇒ rejection-all is correct, but operator should be explicit)', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        CORS_ORIGINS: '',
      });
      // Empty string is treated as "nothing set" — schema default
      // kicks in (http://localhost:4005), which fails the prod check.
      expect(result.success).toBe(false);
    });
  });
});
