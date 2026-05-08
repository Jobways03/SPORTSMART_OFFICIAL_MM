import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 4 (PR 4.5) — Smoke test for the three authorization flags.
 *
 * The cutover runbook (docs/runbooks/phase-4-authorization-cutover.md)
 * walks ops through flipping these flags one at a time. Pin the
 * defaults and the parsing behaviour so a future schema refactor
 * doesn't silently change "false" to a coerced boolean and break the
 * `getBoolean` reads in PermissionsGuard / PolicyEvaluatorService.
 */
describe('authorization env flags — schema shape', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://x',
    REDIS_URL: 'redis://x',
    JWT_CUSTOMER_SECRET: 'a'.repeat(32),
    JWT_SELLER_SECRET: 'a'.repeat(32),
    JWT_FRANCHISE_SECRET: 'a'.repeat(32),
    JWT_ADMIN_SECRET: 'a'.repeat(32),
    JWT_AFFILIATE_SECRET: 'a'.repeat(32),
    AFFILIATE_ENCRYPTION_KEY: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'a'.repeat(32),
  };

  it('PERMISSIONS_GUARD_STRICT defaults to "false"', () => {
    const env = envSchema.parse(baseEnv);
    expect(env.PERMISSIONS_GUARD_STRICT).toBe('false');
  });

  it('ABAC_ENABLED defaults to "false"', () => {
    const env = envSchema.parse(baseEnv);
    expect(env.ABAC_ENABLED).toBe('false');
  });

  it('AUTHZ_AUDIT_ENABLED defaults to "true"', () => {
    const env = envSchema.parse(baseEnv);
    expect(env.AUTHZ_AUDIT_ENABLED).toBe('true');
  });

  it('accepts all flags flipped to true (full strict)', () => {
    const env = envSchema.parse({
      ...baseEnv,
      PERMISSIONS_GUARD_STRICT: 'true',
      ABAC_ENABLED: 'true',
      AUTHZ_AUDIT_ENABLED: 'true',
    });
    expect(env.PERMISSIONS_GUARD_STRICT).toBe('true');
    expect(env.ABAC_ENABLED).toBe('true');
    expect(env.AUTHZ_AUDIT_ENABLED).toBe('true');
  });

  it('flags remain string-typed (parsed via getBoolean at read site)', () => {
    const env = envSchema.parse({
      ...baseEnv,
      PERMISSIONS_GUARD_STRICT: 'true',
      ABAC_ENABLED: 'false',
    });
    // getBoolean does `String(value) === 'true'`. Pinning the type
    // prevents a future refactor to z.boolean() from silently changing
    // semantics (e.g. boolean false → "false" === "true" → false; that's
    // fine, but the inverse — string "false" → "false" === "true" =>
    // false — only works because the value is a string).
    expect(typeof env.PERMISSIONS_GUARD_STRICT).toBe('string');
    expect(typeof env.ABAC_ENABLED).toBe('string');
    expect(typeof env.AUTHZ_AUDIT_ENABLED).toBe('string');
  });
});
