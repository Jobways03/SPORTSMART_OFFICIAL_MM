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
 */

describe('env schema — NODE_ENV=production gate', () => {
  const baseDevEnv = {
    NODE_ENV: 'development' as const,
    DATABASE_URL: 'postgresql://localhost/sportsmart_dev',
    REDIS_URL: 'redis://localhost:6379',
    JWT_CUSTOMER_SECRET: 'a'.repeat(32),
    JWT_SELLER_SECRET: 'a'.repeat(32),
    JWT_FRANCHISE_SECRET: 'a'.repeat(32),
    JWT_ADMIN_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'a'.repeat(32),
  };

  it('accepts a dev env with optional integrations missing', () => {
    const parsed = envSchema.parse(baseDevEnv);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.RAZORPAY_KEY_SECRET).toBeUndefined();
  });

  it('rejects a prod env missing RAZORPAY_KEY_SECRET', () => {
    const result = envSchema.safeParse({
      ...baseDevEnv,
      NODE_ENV: 'production',
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
      ...baseDevEnv,
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: '   ',
      RAZORPAY_WEBHOOK_SECRET: 'whsec_x',
      S3_BUCKET: 'x',
      S3_REGION: 'ap-south-1',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'x',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const keys = result.error.issues.map((i) => i.path.join('.'));
      expect(keys).toContain('RAZORPAY_KEY_SECRET');
    }
  });

  it('accepts a prod env with all required integration secrets present', () => {
    const result = envSchema.safeParse({
      ...baseDevEnv,
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'secret-x',
      RAZORPAY_WEBHOOK_SECRET: 'whsec_x',
      S3_BUCKET: 'sportsmart-prod',
      S3_REGION: 'ap-south-1',
      S3_ACCESS_KEY: 'akid',
      S3_SECRET_KEY: 'akidsecret',
    });
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
