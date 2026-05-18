import { randomBytes } from 'crypto';

/**
 * Phase 10 (PR 10.1) — TOTP secret generation.
 *
 * RFC 6238 specifies HMAC-SHA1 with a shared secret. RFC 4226 says
 * "the shared secret MUST be at least 128 bits, recommended 160 bits"
 * — we use 160 bits (20 bytes) for both compatibility with every
 * mainstream authenticator app (Google / Authy / 1Password / Bitwarden
 * all expect 20-byte secrets) and HMAC-SHA1's natural block size.
 *
 * Encoding is RFC 4648 base32 (without padding for compactness in the
 * otpauth:// URI). Authenticator apps universally accept unpadded
 * base32 in the `secret` parameter.
 *
 * This module is intentionally pure — no I/O, no env reads, no Nest
 * decorators. The persistence + encryption layer wraps it.
 */

const SECRET_BYTE_LENGTH = 20; // 160 bits per RFC 4226 recommendation
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode an arbitrary buffer into RFC 4648 base32 (no padding).
 * Authenticator apps accept either padded or unpadded; we omit the
 * `=` padding because the otpauth:// URI looks cleaner without it
 * and the parsers don't require it.
 */
export function bufferToBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Generate a fresh TOTP shared secret (20 random bytes → base32).
 * Returns the base32 string ready to embed in an otpauth:// URI.
 *
 * Uses Node's crypto.randomBytes (libuv-backed, CSPRNG). NOT
 * Math.random — TOTP secrets are credentials and a predictable
 * source would let an attacker brute-force codes.
 */
export function generateTotpSecret(): string {
  return bufferToBase32(randomBytes(SECRET_BYTE_LENGTH));
}
