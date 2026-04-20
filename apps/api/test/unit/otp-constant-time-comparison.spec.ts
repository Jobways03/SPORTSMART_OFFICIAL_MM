import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for OTP comparison timing attacks.
 *
 * Before: every verify-OTP use-case used `if (otpHash !== otpRecord.otpHash)`
 * — a plain JS string compare that short-circuits on the first differing
 * byte. An attacker able to time requests could recover a valid OTP hash
 * byte-by-byte. Academically feasible on a LAN; matters for shared-infra
 * hosting and any future move toward longer-lived reset tokens.
 *
 * After: all six sites use `crypto.timingSafeEqual` on equal-length
 * Buffers. This test asserts the guard is present in every file so a
 * future refactor can't silently regress back to `!==`.
 */

const OTP_USE_CASE_FILES = [
  'src/modules/identity/application/use-cases/verify-reset-otp.use-case.ts',
  'src/modules/admin/application/use-cases/verify-admin-reset-otp.use-case.ts',
  'src/modules/seller/application/use-cases/verify-reset-otp-seller.use-case.ts',
  'src/modules/seller/application/use-cases/verify-seller-email.use-case.ts',
  'src/modules/franchise/application/use-cases/verify-reset-otp-franchise.use-case.ts',
  'src/modules/franchise/application/use-cases/verify-franchise-email.use-case.ts',
];

describe('OTP verification — constant-time hash comparison', () => {
  it.each(OTP_USE_CASE_FILES)(
    'uses timingSafeEqual instead of === in %s',
    (relativePath) => {
      const absolutePath = join(__dirname, '..', '..', relativePath);
      const source = readFileSync(absolutePath, 'utf8');

      // Must import the safe primitive.
      expect(source).toMatch(/timingSafeEqual/);
      // Must not still contain the unsafe pattern against stored otpHash.
      expect(source).not.toMatch(/otpHash\s*!==\s*otpRecord\.otpHash/);
      expect(source).not.toMatch(/otpHash\s*===\s*otpRecord\.otpHash/);
    },
  );
});
