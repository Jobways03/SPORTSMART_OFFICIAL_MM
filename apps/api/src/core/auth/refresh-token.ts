import { createHash, randomUUID } from 'crypto';

/**
 * Phase 3 (PR 3.2) — refresh-token hashing at rest.
 *
 * Pre-PR the four session tables (sessions, admin_sessions,
 * seller_sessions, franchise_sessions) stored the refresh token as
 * the plaintext UUID emitted at login. A DB compromise (`pg_dump`,
 * backup leak, accidental `SELECT *` in an ops shell) hands the
 * attacker every live session, indistinguishable from the legitimate
 * owner.
 *
 * The fix: store SHA-256 of the token, return the raw token only
 * once at issue time. SHA-256 (not bcrypt/argon2) because:
 *
 *   1. The raw token is already 128 bits of entropy (`randomUUID`
 *      from Node's CSPRNG). There's nothing to slow-grind — the
 *      preimage space is impossibly large.
 *   2. Refresh lookup must be O(1). SHA-256 is deterministic; bcrypt
 *      would force a full-table scan with per-row salt-compare.
 *   3. Defending against a DB compromise is the whole point. A salted
 *      KDF defends against offline crack of low-entropy passwords —
 *      not the threat model here.
 *
 * Encoding: hex (64 chars). DB column is TEXT, no length impact.
 *
 * Single conversion point: every store and every lookup goes through
 * `hashRefreshToken`. The regression-guard spec ensures no code path
 * persists or queries a raw refresh token.
 */
export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Mint a fresh refresh token. The raw value is returned to the caller
 * (response body) — the DB-side caller must immediately call
 * `hashRefreshToken` to derive the value that lands in the session
 * row. Wrapping the UUID call here keeps the entropy source consistent
 * (Node `randomUUID` is CSPRNG-backed).
 */
export function mintRawRefreshToken(): string {
  return randomUUID();
}
