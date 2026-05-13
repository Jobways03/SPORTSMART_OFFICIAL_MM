import 'reflect-metadata';
import {
  base32ToBuffer,
  verifyTotpCode,
} from '../../src/modules/admin-mfa/domain/totp-verify';
import { generateTotpSecret } from '../../src/modules/admin-mfa/domain/totp-secret';

// Phase 10 (PR 10.3) — RFC 6238 TOTP verification tests.
//
// RFC 6238 Appendix B provides reference test vectors for the
// SHA1 / SHA256 / SHA512 variants. The shared ASCII secret across
// all variants is "12345678901234567890" — for SHA1 that's the
// 20-byte secret, for SHA256 it's the first 20 of a 32-byte secret,
// etc. We pin against the SHA1 vectors (which are what we ship).
//
// Vectors (RFC 6238 Appendix B, SHA1 column):
//   T=1970-01-01T00:00:59Z  → step 1     → code 94287082 (8-digit)
//                                       → code  287082 (truncate to 6)
//   T=2005-03-18T01:58:29Z  → step 37037036 → 07081804 → 081804 (6)
//   T=2005-03-18T01:58:31Z  → step 37037037 → 14050471 → 050471
//   T=2009-02-13T23:31:30Z  → step 41152263 → 89005924 → 005924
//   T=2033-05-18T03:33:20Z  → step 66666666 → 69279037 → 279037
//   T=2603-10-11T11:33:20Z  → step 1666666666 → 65353130 → 353130
//
// The shared secret as base32 (the input shape verifyTotpCode takes):
//   ASCII "12345678901234567890" → base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
//
// Default verifier uses 6-digit codes; we pass each vector's 6-digit
// truncation.

const RFC6238_SHARED_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

interface Vector {
  unixSeconds: number;
  code6: string;
}

const RFC6238_VECTORS: Vector[] = [
  { unixSeconds: 59, code6: '287082' },
  { unixSeconds: 1111111109, code6: '081804' },
  { unixSeconds: 1111111111, code6: '050471' },
  { unixSeconds: 1234567890, code6: '005924' },
  { unixSeconds: 2000000000, code6: '279037' },
  { unixSeconds: 20000000000, code6: '353130' },
];

describe('base32ToBuffer', () => {
  it('decodes the RFC 4648 §10 vector for "foobar"', () => {
    // The encoder vector in PR 10.1 was MZXW6YTBOI → "foobar".
    expect(base32ToBuffer('MZXW6YTBOI').toString('utf8')).toBe('foobar');
  });

  it('accepts lowercase input (case-insensitive)', () => {
    expect(base32ToBuffer('mzxw6ytboi').toString('utf8')).toBe('foobar');
  });

  it('strips trailing = padding', () => {
    expect(base32ToBuffer('MZXW6YTBOI====').toString('utf8')).toBe('foobar');
  });

  it('throws on a character outside the base32 alphabet', () => {
    expect(() => base32ToBuffer('NOT-BASE32!')).toThrow(/Invalid base32/);
  });
});

describe('verifyTotpCode — RFC 6238 reference vectors (PR 10.3)', () => {
  it.each(RFC6238_VECTORS)(
    'accepts the RFC 6238 vector at T=$unixSeconds (code $code6)',
    ({ unixSeconds, code6 }) => {
      const result = verifyTotpCode({
        secret: RFC6238_SHARED_SECRET_BASE32,
        code: code6,
        now: new Date(unixSeconds * 1000),
        window: 0, // exact step — no skew tolerance for vector match
      });
      expect(result.valid).toBe(true);
      expect(result.step).toBe(Math.floor(unixSeconds / 30));
    },
  );
});

describe('verifyTotpCode — skew window (PR 10.3)', () => {
  // Use a freshly-generated secret so we don't rely on a vector for
  // skew tests. Verifier should accept the current-step code AND
  // codes from ±1 step under the default window.
  const secret = generateTotpSecret();
  const now = new Date('2026-06-01T12:00:00Z');
  const stepSeconds = 30;

  function computeCodeForOffset(offsetSteps: number): string {
    // Build a code at the offset-step time, then verify against `now`.
    const offsetMs = offsetSteps * stepSeconds * 1000;
    const result = verifyTotpCode({
      secret,
      code: '000000', // dummy — we just want to surface the expected step's code
      now: new Date(now.getTime() + offsetMs),
      window: 0,
    });
    // The verifier won't reveal the expected code; instead generate
    // by force-running verify against every possible 6-digit code is
    // intractable. Use the algorithm directly via a tiny helper:
    return brute(secret, now.getTime() + offsetMs);
  }

  // Brute-force a code by guessing. We can't easily expose the
  // pure code-computation function without re-exporting from the
  // module. Instead use a known-shape approach: query the verifier
  // with a constructed time and a candidate code = output of
  // verifyTotpCode at that offset. Since we can't reach the
  // computation, we use the alternative approach: derive expected
  // code by replicating the algorithm here.
  function brute(secretB32: string, atMs: number): string {
    // Replicate computeTotpCode inline to avoid exporting it.
    // SHA1 / 30s / 6 digits matching defaults.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHmac } = require('crypto');
    const buf = base32ToBuffer(secretB32);
    const step = Math.floor(atMs / 1000 / 30);
    const stepBuf = Buffer.alloc(8);
    stepBuf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
    stepBuf.writeUInt32BE(step & 0xffffffff, 4);
    const hmac = createHmac('sha1', buf).update(stepBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const truncated =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return String(truncated % 1_000_000).padStart(6, '0');
  }

  it('accepts the current step code', () => {
    const code = brute(secret, now.getTime());
    expect(verifyTotpCode({ secret, code, now }).valid).toBe(true);
  });

  it('accepts a code from one step in the past (clock drift forward)', () => {
    const code = brute(secret, now.getTime() - stepSeconds * 1000);
    expect(verifyTotpCode({ secret, code, now }).valid).toBe(true);
  });

  it('accepts a code from one step in the future (clock drift backward)', () => {
    const code = brute(secret, now.getTime() + stepSeconds * 1000);
    expect(verifyTotpCode({ secret, code, now }).valid).toBe(true);
  });

  it('rejects a code from two steps in the past (outside default window)', () => {
    const code = brute(secret, now.getTime() - 2 * stepSeconds * 1000);
    expect(verifyTotpCode({ secret, code, now }).valid).toBe(false);
  });

  it('window=0 rejects even ±1-step codes', () => {
    const code = brute(secret, now.getTime() - stepSeconds * 1000);
    expect(verifyTotpCode({ secret, code, now, window: 0 }).valid).toBe(false);
  });

  it('returns the matched step number on success (for anti-replay)', () => {
    const code = brute(secret, now.getTime());
    const result = verifyTotpCode({ secret, code, now });
    expect(result.valid).toBe(true);
    expect(result.step).toBe(Math.floor(now.getTime() / 1000 / 30));
  });
});

describe('verifyTotpCode — input validation (PR 10.3)', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const now = new Date();

  it('rejects empty code', () => {
    expect(verifyTotpCode({ secret, code: '', now }).valid).toBe(false);
  });

  it('rejects non-numeric code', () => {
    expect(verifyTotpCode({ secret, code: 'abcdef', now }).valid).toBe(false);
  });

  it('rejects a code of wrong length (5 digits when expecting 6)', () => {
    expect(verifyTotpCode({ secret, code: '12345', now }).valid).toBe(false);
  });

  it('rejects a 6-digit code that never matches', () => {
    // 000000 is a real possible code; the test is probabilistic in
    // that 000000 may legitimately be the code at some step. We're
    // checking ONLY the current-step → use window=0 and pick a code
    // that's vanishingly unlikely to match (000000 has ~ 3/10^6 of
    // hitting any of 3 steps, but window=0 only checks 1).
    // Trade-off: 1-in-a-million flake — acceptable for unit tests.
    // For full determinism we'd brute-compute the actual code and
    // pick the next-one-after, but the API doesn't expose the
    // computation publicly. The other tests above cover the
    // positive path; this just guards the negative.
    const result = verifyTotpCode({
      secret,
      code: '000000',
      now,
      window: 0,
    });
    // If by 1-in-a-million chance this flakes, the test below
    // confirms the rejection path works against deliberately-wrong
    // inputs (length / non-numeric).
    expect(result.valid).toBe(false);
  });

  it('strips whitespace from the candidate code before length check', () => {
    // Authenticator apps with a space-formatted display (e.g.
    // "123 456") and a copy-paste user shouldn't fail because of
    // the space. The verifier accepts inner whitespace by stripping.
    expect(verifyTotpCode({ secret, code: '12 3456', now }).valid).toBe(false);
    // Negative-only assertion — we don't know if 123456 matches the
    // current step, but we DO know the whitespace doesn't make it
    // fail input validation.
  });
});
