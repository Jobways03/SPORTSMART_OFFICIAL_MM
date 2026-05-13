import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Phase 10 (PR 10.3) — RFC 6238 TOTP code verification.
 *
 * Algorithm per RFC 6238 (which is RFC 4226 HOTP with T = floor(now/period)):
 *
 *   1. Compute T = floor((unix_seconds - T0) / period). T0 = 0.
 *   2. Encode T as an 8-byte big-endian integer.
 *   3. HMAC-{algorithm}(secret_bytes, T_bytes).
 *   4. Dynamic truncation (RFC 4226 §5.4):
 *        offset = hmac[length-1] & 0x0F
 *        truncated = (hmac[offset+0] & 0x7F) << 24
 *                  | (hmac[offset+1] & 0xFF) << 16
 *                  | (hmac[offset+2] & 0xFF) << 8
 *                  | (hmac[offset+3] & 0xFF)
 *   5. code = truncated mod 10^digits, zero-padded to `digits` chars.
 *
 * Skew window: the verifier accepts codes from steps in
 * [now-window .. now+window]. Default ±1 covers up to 30s of clock
 * drift between server and authenticator, which is the spec-recommended
 * tolerance. Tightening to 0 makes the system unusable under any real
 * NTP skew; widening past ±2 noticeably weakens brute-force resistance.
 *
 * Constant-time compare: a naive string-equality check would leak
 * which digit was wrong via timing, letting an attacker brute-force
 * codes digit-by-digit (4 × 10 + 2 attempts instead of 10^6).
 * `crypto.timingSafeEqual` is the right primitive.
 *
 * Anti-replay: NOT handled here — this verifier is pure (no state).
 * The application-layer wrapper records the matched step alongside
 * the admin id and rejects re-presentation of the same step. That
 * keeps the pure-function surface minimal and the replay-prevention
 * logic explicit at the call site.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode an RFC 4648 base32 string (case-insensitive, optional `=`
 * padding) into raw bytes. Throws if the input contains a character
 * outside the base32 alphabet. Authenticator apps and the generator
 * in PR 10.1 both produce inputs this function accepts.
 */
export function base32ToBuffer(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new Error(`Invalid base32 character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export interface VerifyTotpCodeArgs {
  /** Base32-encoded TOTP shared secret (from generateTotpSecret). */
  secret: string;
  /** Candidate code presented by the user. May contain whitespace. */
  code: string;
  /** Now-time used for the step counter. Defaults to Date.now(). */
  now?: Date;
  /** ±steps tolerated for clock drift. Default 1 (covers ~30s drift). */
  window?: number;
  /** HMAC algorithm — default SHA1 per RFC 6238. */
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  /** Code length. Default 6. */
  digits?: number;
  /** Step period in seconds. Default 30. */
  period?: number;
}

export interface VerifyTotpCodeResult {
  valid: boolean;
  /**
   * The step the matched code came from (used by the application
   * layer for anti-replay tracking). Undefined when valid=false.
   */
  step?: number;
}

/**
 * Compute the TOTP code for a given secret + step, with explicit
 * algorithm / digits parameters. Pure function — no state, no I/O.
 */
function computeTotpCode(args: {
  secret: Buffer;
  step: number;
  algorithm: 'sha1' | 'sha256' | 'sha512';
  digits: number;
}): string {
  const { secret, step, algorithm, digits } = args;
  // Encode the step counter as an 8-byte big-endian integer.
  const stepBuf = Buffer.alloc(8);
  // JS number can hold up to 2^53 safely; for step counters (seconds /
  // 30) that's good through year ~9000. No need for BigInt here.
  stepBuf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  stepBuf.writeUInt32BE(step & 0xffffffff, 4);

  const hmac = createHmac(algorithm, secret).update(stepBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const modulus = 10 ** digits;
  const code = truncated % modulus;
  return String(code).padStart(digits, '0');
}

export function verifyTotpCode(args: VerifyTotpCodeArgs): VerifyTotpCodeResult {
  const {
    secret,
    code,
    now = new Date(),
    window = 1,
    algorithm = 'sha1',
    digits = 6,
    period = 30,
  } = args;

  // Normalise the candidate: trim whitespace, reject non-digit.
  // Refusing whitespace-only or non-numeric input early avoids
  // computing HMACs against obvious garbage.
  const candidate = code.replace(/\s+/g, '');
  if (!/^\d+$/.test(candidate) || candidate.length !== digits) {
    return { valid: false };
  }

  const secretBuf = base32ToBuffer(secret);
  const currentStep = Math.floor(now.getTime() / 1000 / period);
  const candidateBuf = Buffer.from(candidate, 'utf8');

  // Try every step in [now-window .. now+window]. Constant-time
  // compare each. We can't short-circuit on first match without
  // leaking timing — though the leak is "valid step number" rather
  // than "valid code", which is much less useful to an attacker
  // because the server's clock is observable through other channels.
  // Short-circuit on match for clarity; the anti-replay layer
  // upstream is the harder defence anyway.
  for (let delta = -window; delta <= window; delta++) {
    const step = currentStep + delta;
    if (step < 0) continue; // before epoch — meaningless
    const expected = computeTotpCode({
      secret: secretBuf,
      step,
      algorithm,
      digits,
    });
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      expectedBuf.length === candidateBuf.length &&
      timingSafeEqual(expectedBuf, candidateBuf)
    ) {
      return { valid: true, step };
    }
  }
  return { valid: false };
}
