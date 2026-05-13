import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 3 (PR 3.5) — JWT secret uniqueness invariant.
 *
 * The codebase ships six JWT secrets (one per actor type + a refresh
 * secret) precisely because per-actor isolation is a security
 * property: a leaked customer secret should not let the attacker
 * forge admin tokens. That property breaks the moment two of the six
 * env vars carry the same string — a "you typed `paste` twice"
 * footgun easy to commit during a hurried prod rollout.
 *
 * Schema-level pairwise-distinctness check at parse time, fail-fast
 * at boot. AnyAuthGuard (which iterates all five actor secrets to
 * verify the token) is the canonical example of why this matters:
 * with two identical secrets, a customer token would resolve as
 * either a customer OR an admin (whichever attempt order picks first).
 *
 * The check runs on EVERY env (not prod-only) because dev / staging
 * also exercise the AnyAuthGuard fan-out, and a dev with collision
 * would mask the prod bug.
 */

const SECRETS: Record<string, string> = {
  JWT_CUSTOMER_SECRET: 'c'.repeat(32),
  JWT_SELLER_SECRET: 's'.repeat(32),
  JWT_FRANCHISE_SECRET: 'f'.repeat(32),
  JWT_ADMIN_SECRET: 'a'.repeat(32),
  JWT_AFFILIATE_SECRET: 'p'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
};

const baseDevEnv = {
  NODE_ENV: 'development' as const,
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  AFFILIATE_ENCRYPTION_KEY: 'x'.repeat(32),
  ...SECRETS,
};

describe('JWT secret uniqueness (PR 3.5)', () => {
  it('accepts an env where every JWT secret is distinct', () => {
    const result = envSchema.safeParse(baseDevEnv);
    expect(result.success).toBe(true);
  });

  it('rejects an env where two JWT secrets collide', () => {
    const result = envSchema.safeParse({
      ...baseDevEnv,
      JWT_CUSTOMER_SECRET: 'x'.repeat(32),
      JWT_ADMIN_SECRET: 'x'.repeat(32), // collision
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n');
      // The message should name BOTH offending keys so an ops team
      // reading boot logs immediately sees what to change.
      expect(messages).toMatch(/JWT_CUSTOMER_SECRET/);
      expect(messages).toMatch(/JWT_ADMIN_SECRET/);
    }
  });

  it('rejects all-six-identical (the worst case)', () => {
    const result = envSchema.safeParse({
      ...baseDevEnv,
      JWT_CUSTOMER_SECRET: 'y'.repeat(32),
      JWT_SELLER_SECRET: 'y'.repeat(32),
      JWT_FRANCHISE_SECRET: 'y'.repeat(32),
      JWT_ADMIN_SECRET: 'y'.repeat(32),
      JWT_AFFILIATE_SECRET: 'y'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Multiple distinct collision pairs should surface.
      const issuePaths = result.error.issues
        .map((i) => i.path.join('.'))
        .filter((p) => p.startsWith('JWT_'));
      expect(new Set(issuePaths).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects refresh secret colliding with any actor secret', () => {
    // Pre-PR the refresh secret was a separate value; this check
    // ensures it stays separate. Reusing the customer secret for
    // refresh would let a leaked-customer-secret attacker forge
    // refresh tokens too.
    const result = envSchema.safeParse({
      ...baseDevEnv,
      JWT_REFRESH_SECRET: SECRETS.JWT_SELLER_SECRET,
    });
    expect(result.success).toBe(false);
  });

  it('the check applies to every env (not just production)', () => {
    // A dev env with collision would mask a prod misconfiguration
    // (operator does `cp dev.env prod.env` and forgets to rotate).
    // Verify the validation fires in dev too.
    const devCollision = envSchema.safeParse({
      ...baseDevEnv,
      NODE_ENV: 'development',
      JWT_SELLER_SECRET: SECRETS.JWT_CUSTOMER_SECRET,
    });
    expect(devCollision.success).toBe(false);

    const stagingCollision = envSchema.safeParse({
      ...baseDevEnv,
      NODE_ENV: 'staging',
      JWT_SELLER_SECRET: SECRETS.JWT_CUSTOMER_SECRET,
    });
    expect(stagingCollision.success).toBe(false);
  });
});
