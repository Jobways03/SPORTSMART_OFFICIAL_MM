/**
 * Phase 3 (PR 3.1) — JWT algorithm pinning.
 *
 * All access tokens in this codebase are HS256 (symmetric secret).
 * `jsonwebtoken.verify(token, secret)` without an `algorithms` option
 * accepts ANY algorithm the token header declares — the well-known
 * "alg=none" forgery and HS-RS confusion attacks both exploit this.
 *
 * Every call site uses `JWT_VERIFY_OPTIONS` so a future addition can't
 * accidentally regress to an unpinned verify. The same constant is
 * exported as `JWT_SIGN_OPTIONS` so the sign side is explicit too;
 * the library default is already HS256, but stating it removes a
 * silent assumption.
 *
 * Why HS256 and not RS256 / EdDSA: the platform is a single API
 * service — there's no third-party token consumer that needs a public
 * key. HS256 is faster, the secret never leaves the process, and the
 * algorithm-confusion class of bug is moot once verification pins.
 *
 * If the platform later splits into multiple services and wants to
 * federate JWTs, swap the algorithm here (one place) and rotate the
 * keys via the existing JWT_*_SECRET env vars.
 */
import type { SignOptions, VerifyOptions } from 'jsonwebtoken';

export const JWT_ALGORITHM = 'HS256' as const;

/**
 * Phase 17 (2026-05-20) — per-actor JWT audience claims.
 *
 * Each persona's access token carries `aud: <persona-audience>`
 * so a token forged with the wrong actor secret (or a future
 * shape-confusion mistake) cannot pass through the wrong guard.
 * The guard for each persona pins `audience` in JWT_VERIFY_OPTIONS,
 * and jsonwebtoken rejects with `JsonWebTokenError: jwt audience
 * invalid` when the claim mismatches.
 *
 * Keep the strings in lock-step with the constants the guards
 * import — a meta-test verifies guard verify-options use these.
 */
export const JWT_AUDIENCE_CUSTOMER = 'sportsmart-customer';
export const JWT_AUDIENCE_SELLER = 'sportsmart-seller';
export const JWT_AUDIENCE_FRANCHISE = 'sportsmart-franchise';
export const JWT_AUDIENCE_ADMIN = 'sportsmart-admin';
export const JWT_AUDIENCE_AFFILIATE = 'sportsmart-affiliate';

/**
 * Pass as the third argument to `jwt.verify(token, secret, ...)`.
 * Mandatory for every verify in this codebase — the meta-test in
 * `test/unit/jwt-algorithm-pinning.spec.ts` enforces this.
 */
export const JWT_VERIFY_OPTIONS: VerifyOptions = {
  algorithms: [JWT_ALGORITHM],
};

/**
 * Customer-specific verify options. Pins both the algorithm AND the
 * audience claim so a seller/admin/franchise/affiliate token cannot
 * be replayed against the customer guard even if the JWT secrets
 * collide (the pairwise-uniqueness env check already prevents that,
 * but defence in depth).
 */
export const JWT_VERIFY_OPTIONS_CUSTOMER: VerifyOptions = {
  algorithms: [JWT_ALGORITHM],
  audience: JWT_AUDIENCE_CUSTOMER,
};

/**
 * Phase 26 (2026-05-20) — Admin session-token verify options.
 *
 * Pre-Phase-26 the admin guard used JWT_VERIFY_OPTIONS (algorithm pin
 * only), so a challenge token with `aud: 'admin-mfa-challenge'` would
 * pass the verify step and was only rejected later because it lacked
 * the `role` / `sessionId` claims. Defense-by-missing-claim is fragile:
 * a future refactor that adds optional claims to challenge tokens
 * would silently re-open the bypass.
 *
 * Now the guard pins `audience: JWT_AUDIENCE_ADMIN`. Challenge tokens
 * carry `aud: ADMIN_MFA_CHALLENGE_AUD` and fail jwt.verify with
 * `JsonWebTokenError: jwt audience invalid`. Session access tokens
 * are minted with `audience: JWT_AUDIENCE_ADMIN` at the three sign
 * sites (login non-MFA, mfa-verify, refresh).
 */
export const JWT_VERIFY_OPTIONS_ADMIN: VerifyOptions = {
  algorithms: [JWT_ALGORITHM],
  audience: JWT_AUDIENCE_ADMIN,
};

/**
 * Spread into the options argument to `jwt.sign(payload, secret, ...)`.
 * Library default is HS256 today, so this is belt-and-braces; if the
 * default ever changes (or someone copy-pastes from a tutorial that
 * uses a different algorithm), this constant keeps the sign side
 * consistent with the verify side.
 */
export const JWT_SIGN_OPTIONS: SignOptions = {
  algorithm: JWT_ALGORITHM,
};
