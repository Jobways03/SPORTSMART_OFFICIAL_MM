import * as jwt from 'jsonwebtoken';

/**
 * Sign a JWT with the actor-scoped secret conventions used in prod.
 *
 * Tests that hit a guarded endpoint need a bearer token that the
 * matching guard will accept. The four secrets must be set in
 * `process.env` before the guarded module compiles — the simplest
 * approach is to set them in a top-level `beforeAll` in the spec file,
 * then call `mintTestJwt(actor, { sub: '...' })` to get a token.
 *
 * This helper intentionally does NOT cover refresh-token minting —
 * refresh is session-scoped (DB row) and any test that needs it
 * should either seed the session row directly or mock the guard.
 */
export type TestActor = 'customer' | 'seller' | 'franchise' | 'admin';

const SECRET_ENV_VAR: Record<TestActor, string> = {
  customer: 'JWT_CUSTOMER_SECRET',
  seller: 'JWT_SELLER_SECRET',
  franchise: 'JWT_FRANCHISE_SECRET',
  admin: 'JWT_ADMIN_SECRET',
};

export interface MintTestJwtOptions {
  sub: string;
  /** JWT expiry. Default: 1 hour, long enough for a test run. */
  expiresIn?: string | number;
  /** Extra claims to merge into the payload. */
  extra?: Record<string, unknown>;
}

export function mintTestJwt(
  actor: TestActor,
  opts: MintTestJwtOptions,
): string {
  const secret = process.env[SECRET_ENV_VAR[actor]];
  if (!secret || secret.length < 32) {
    throw new Error(
      `Test JWT secret for ${actor} is missing or too short — ` +
        `set ${SECRET_ENV_VAR[actor]} to at least 32 chars in a beforeAll hook.`,
    );
  }
  const { sub, expiresIn = '1h', extra = {} } = opts;
  return jwt.sign(
    { sub, ...extra },
    secret,
    { expiresIn } as jwt.SignOptions,
  );
}

/** Convenience: set all four actor secrets to a deterministic test value. */
export function setTestJwtSecrets(): void {
  process.env.JWT_CUSTOMER_SECRET = 'c'.repeat(32);
  process.env.JWT_SELLER_SECRET = 's'.repeat(32);
  process.env.JWT_FRANCHISE_SECRET = 'f'.repeat(32);
  process.env.JWT_ADMIN_SECRET = 'a'.repeat(32);
}
