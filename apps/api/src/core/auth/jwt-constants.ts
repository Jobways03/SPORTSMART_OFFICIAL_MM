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
 * Pass as the third argument to `jwt.verify(token, secret, ...)`.
 * Mandatory for every verify in this codebase — the meta-test in
 * `test/unit/jwt-algorithm-pinning.spec.ts` enforces this.
 */
export const JWT_VERIFY_OPTIONS: VerifyOptions = {
  algorithms: [JWT_ALGORITHM],
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
