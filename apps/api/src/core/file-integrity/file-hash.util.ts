import { createHash } from 'crypto';

/**
 * Phase 7 (PR 7.1) — content-addressable hashing.
 *
 * Two paths into the same hash:
 *   - direct upload: we already have the buffer in memory.
 *   - confirm of an upload-intent: we re-fetch the bytes from storage
 *     and stream them through here.
 *
 * Pure helpers, no DI. Tests import them directly.
 */

const ALGORITHM = 'sha256';

/** SHA-256 hex string of a Buffer. Used at direct-upload time. */
export function hashBuffer(buf: Buffer): string {
  return createHash(ALGORITHM).update(buf).digest('hex');
}

/**
 * Constant-time(-ish) equality check for two hex hashes. Uses the
 * built-in === because both inputs are already constant-length hex
 * strings produced by the same algorithm — there's no timing-attack
 * surface on the hash itself (it's not a secret). The function exists
 * to make the call site explicit ("we are comparing integrity hashes")
 * rather than for cryptographic protection.
 */
export function hashesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export const HASH_ALGORITHM = ALGORITHM;
