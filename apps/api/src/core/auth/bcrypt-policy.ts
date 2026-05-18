import * as bcrypt from 'bcrypt';

/**
 * Phase 13 (2026-05-16) — central bcrypt cost policy.
 *
 * Every actor module (admin, seller, franchise, customer, affiliate)
 * historically rolled its own `bcrypt.hash(password, 12)` literal,
 * with the affiliate module accidentally using cost 10. Centralising
 * the constant + the rehash-on-login helper means:
 *
 *   • One place to ratchet the cost as hardware gets faster (next
 *     bump is cost 14 when ARM64 Graviton4 lands as the API tier;
 *     bcrypt cost ~50ms is the target).
 *   • Login flows automatically upgrade legacy hashes on the next
 *     successful sign-in without the user noticing — by the time
 *     the older hashes finish rotating, a stolen DB dump is
 *     irrelevant.
 *   • Test fixtures keep their cheap cost (4) via `BCRYPT_TEST_COST`
 *     so unit tests don't add seconds per spec.
 */

export const BCRYPT_TARGET_COST = 12;

/** Lowest cost the policy tolerates without forcing a rehash. */
export const BCRYPT_MIN_ACCEPTABLE_COST = BCRYPT_TARGET_COST;

/** Cheap cost used by spec helpers — never used in production code. */
export const BCRYPT_TEST_COST = 4;

/**
 * Extract the cost factor from a bcrypt hash. Returns null when the
 * hash doesn't look like a bcrypt string (e.g. legacy SHA hashes from
 * an older import). The hash format is `$2[a|b|y]$<cost>$<salt+hash>`.
 */
export function bcryptCostOf(hash: string | null | undefined): number | null {
  if (!hash || typeof hash !== 'string') return null;
  const m = /^\$2[aby]?\$(\d{1,2})\$/.exec(hash);
  if (!m || m[1] === undefined) return null;
  const cost = parseInt(m[1], 10);
  return Number.isFinite(cost) ? cost : null;
}

/**
 * "Should we rehash this password?" decision used by login flows.
 * Returns true when the stored hash is below the target cost (or
 * isn't a recognisable bcrypt string at all). Login use cases call
 * this after `bcrypt.compare` succeeds and conditionally re-hash +
 * persist the new hash.
 */
export function shouldRehash(hash: string | null | undefined): boolean {
  const cost = bcryptCostOf(hash);
  if (cost === null) return true; // unknown format — rotate eagerly
  return cost < BCRYPT_MIN_ACCEPTABLE_COST;
}

/**
 * Convenience: hash a password at the current target cost. Use this
 * everywhere new hashes are written; never call `bcrypt.hash(pwd, 12)`
 * with an inline cost literal again — the constant moves over time.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_TARGET_COST);
}
