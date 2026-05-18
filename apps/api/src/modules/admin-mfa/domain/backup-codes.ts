import { randomBytes } from 'crypto';

/**
 * Phase 10 (PR 10.9) — Backup code generation + format detection.
 *
 * Backup codes are the recovery path for "TOTP device lost." Without
 * them, an admin who reflashes their phone or loses the authenticator
 * is permanently locked out — unacceptable as soon as MFA enforcement
 * is widespread. Each admin gets 10 codes at enrollment time, hashed
 * with bcrypt and stored in `mfaBackupCodesHashes`. Each code is
 * single-use: the verifier removes the consumed hash from the array.
 *
 * Format choices:
 *   - 10 codes (industry standard — GitHub / Auth0 / Okta all use 10).
 *   - 10 alphanumeric chars per code, formatted as XXXXX-XXXXX with a
 *     hyphen for visual separation. ~50 bits of entropy per code.
 *   - Alphabet excludes the visually-ambiguous {0, O, 1, l, I} to
 *     reduce read-aloud / handwrite errors during recovery.
 *
 * Pure-function module: no I/O, no env, no bcrypt. The hashing +
 * persistence layer composes these primitives.
 */

// 32 chars - 5 ambiguous = 27 in the alphabet. Plenty for ~50 bits
// of entropy across 10 chars (log2(27^10) ≈ 47.5 bits).
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODES_PER_ADMIN = 10;
const CODE_LENGTH = 10; // 5 + 5 with a hyphen in the display form

/**
 * Cryptographically-random index into the alphabet. Uses rejection
 * sampling so the resulting distribution is uniform (a naive `byte
 * % alphabet.length` is biased toward the early alphabet positions
 * because 256 isn't a multiple of 27).
 */
function pickIndex(): number {
  const maxFair = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const b = randomBytes(1)[0]!;

    if (b < maxFair) return b % ALPHABET.length;
  }
}

/**
 * Generate a single backup code, formatted as XXXXX-XXXXX. Used
 * internally by `generateBackupCodes` and exposed for tests.
 */
export function generateBackupCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[pickIndex()];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * Generate a fresh batch of 10 backup codes. Each is the recovery
 * key for a single MFA-locked-out scenario; the admin keeps them
 * somewhere offline (printed, password manager) and uses one per
 * lockout incident. The codes are returned cleartext ONCE at
 * enrollment time; the persisted form is bcrypt-hashed.
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < CODES_PER_ADMIN; i++) {
    codes.push(generateBackupCode());
  }
  return codes;
}

/**
 * Returns true when `input` (whitespace-trimmed) matches the backup
 * code format: 5 alphanumeric chars, a hyphen, 5 alphanumeric chars.
 * The login-challenge-verify endpoint uses this to discriminate
 * between a TOTP code (6 digits) and a backup code.
 */
export function isBackupCodeFormat(input: string): boolean {
  const trimmed = input.replace(/\s+/g, '').toLowerCase();
  return /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(trimmed);
}

/**
 * Normalise a candidate backup code into the canonical form for
 * bcrypt comparison: lowercase, no surrounding whitespace, hyphen
 * preserved. The hash-and-store path uses the same canonicalisation,
 * so a code typed in uppercase or with stray spaces still matches.
 */
export function normaliseBackupCode(input: string): string {
  return input.replace(/\s+/g, '').toLowerCase();
}
