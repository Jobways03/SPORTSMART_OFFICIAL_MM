import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Regression test for production env validation.
 *
 * Before: the schema marked every integration secret (RAZORPAY_*,
 * S3_*, SHIPROCKET_*, …) as `z.string().optional()`. That's correct
 * for dev, where you want to boot the API without paid accounts — but
 * it meant a prod rollout with a missing `RAZORPAY_KEY_SECRET` booted
 * fine and only surfaced the problem when the first customer tried to
 * check out, at which point the HMAC verifier would have been
 * comparing against a zero-key digest (fixed separately in the
 * payment verify path).
 *
 * After: the schema layers a `.superRefine` that enforces the set of
 * prod-critical secrets only when `NODE_ENV === 'production'`. Dev and
 * test continue to parse with minimal input.
 *
 * PR 12.1 — Fixture brought up to current shape: Phase 4 added two
 * always-required env vars (JWT_AFFILIATE_SECRET, AFFILIATE_ENCRYPTION_KEY)
 * that any dev env must satisfy. Phase 6 added 16 prod-required flags
 * to `requiredOnInProd`. Phase 10 added ADMIN_MFA_ENCRYPTION_KEY to
 * `requiredInProd`. PR 3.7 added the prod-only CORS_ORIGINS hardening.
 * baseProdEnv mirrors the canonical fixture shape used by sibling
 * env-policy specs (e.g. cron-heartbeat-prod-required.spec.ts).
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

describe('env schema — NODE_ENV=production gate', () => {
  const baseDevEnv = {
    NODE_ENV: 'development' as const,
    DATABASE_URL: 'postgresql://localhost/sportsmart_dev',
    REDIS_URL: 'redis://localhost:6379',
    ...SECRETS,
  };

  // All prod-required secrets + prod-required flags + CORS_ORIGINS,
  // minus the specific values each test wants to assert against.
  // Tests omit individual fields to provoke the corresponding rejection.
  const baseProdEnv = {
    ...baseDevEnv,
    NODE_ENV: 'production' as const,
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 'secret-x',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_x',
    S3_BUCKET: 'sportsmart-prod',
    S3_REGION: 'ap-south-1',
    S3_ACCESS_KEY: 'akid',
    S3_SECRET_KEY: 'akidsecret',
    ADMIN_MFA_ENCRYPTION_KEY: 'm'.repeat(32),
    APP_URL: 'https://api.sportsmart.com',
    CORS_ORIGINS: 'https://app.sportsmart.com',
    // Phase 6 — every requiredOnInProd flag must be 'true' in prod.
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
  };

  it('accepts a dev env with optional integrations missing', () => {
    const parsed = envSchema.parse(baseDevEnv);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.RAZORPAY_KEY_SECRET).toBeUndefined();
  });

  it('rejects a prod env missing the Razorpay + S3 integration secrets', () => {
    const result = envSchema.safeParse({
      ...baseProdEnv,
      RAZORPAY_KEY_ID: undefined,
      RAZORPAY_KEY_SECRET: undefined,
      RAZORPAY_WEBHOOK_SECRET: undefined,
      S3_BUCKET: undefined,
      S3_REGION: undefined,
      S3_ACCESS_KEY: undefined,
      S3_SECRET_KEY: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join('.'));
      expect(issues).toEqual(
        expect.arrayContaining([
          'RAZORPAY_KEY_ID',
          'RAZORPAY_KEY_SECRET',
          'RAZORPAY_WEBHOOK_SECRET',
          'S3_BUCKET',
          'S3_REGION',
          'S3_ACCESS_KEY',
          'S3_SECRET_KEY',
        ]),
      );
    }
  });

  it('rejects a prod env with a blank RAZORPAY_KEY_SECRET (whitespace-only)', () => {
    const result = envSchema.safeParse({
      ...baseProdEnv,
      RAZORPAY_KEY_SECRET: '   ',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const keys = result.error.issues.map((i) => i.path.join('.'));
      expect(keys).toContain('RAZORPAY_KEY_SECRET');
    }
  });

  it('accepts a prod env with all required integration secrets present', () => {
    const result = envSchema.safeParse(baseProdEnv);
    expect(result.success).toBe(true);
  });

  it('still accepts a staging env without integration secrets', () => {
    // Staging is intentionally not gated — a staging environment may
    // mock integrations or proxy through dev credentials. Only
    // NODE_ENV=production is strict.
    const result = envSchema.safeParse({
      ...baseDevEnv,
      NODE_ENV: 'staging',
    });
    expect(result.success).toBe(true);
  });
});
