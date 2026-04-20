import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the payment-verify signature verifier.
 *
 * Before: the verifier had two bugs:
 *   1. `process.env.RAZORPAY_KEY_SECRET || ''` → if the env var was
 *      unset, the HMAC was keyed with an empty string. hmac('', x) is
 *      deterministic and publicly reproducible, so an attacker could
 *      forge a valid signature and self-verify any pending-payment
 *      order. Fail-open with dire consequences.
 *   2. `expectedSignature !== input.razorpaySignature` — plain JS
 *      string compare that short-circuits on the first differing byte.
 *      Same timing-attack class as the OTP compare we fixed earlier.
 *
 * After: fail closed when secret missing (throws BadRequest), and
 * compare with `crypto.timingSafeEqual` on equal-length Buffers.
 *
 * We assert by grepping the source file so the guards can't be
 * silently removed by a future refactor.
 */

describe('CheckoutService.verifyPayment — signature guards', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src/modules/checkout/application/services/checkout.service.ts',
    ),
    'utf8',
  );

  it('does NOT fall back to an empty-string HMAC key', () => {
    // The buggy pattern: process.env.RAZORPAY_KEY_SECRET || ''
    expect(source).not.toMatch(
      /RAZORPAY_KEY_SECRET\s*\|\|\s*['"]['"]/,
    );
  });

  it('explicitly fails closed when RAZORPAY_KEY_SECRET is missing', () => {
    // Must throw (or otherwise abort) inside verifyPayment if the env
    // var is absent. We look for the narrowly-scoped guard pattern.
    expect(source).toMatch(
      /const\s+keySecret\s*=\s*process\.env\.RAZORPAY_KEY_SECRET\s*;?\s*\n\s*if\s*\(\s*!\s*keySecret\s*\)/,
    );
  });

  it('uses timingSafeEqual for the signature compare', () => {
    expect(source).toMatch(/timingSafeEqual/);
    expect(source).not.toMatch(
      /expectedSignature\s*!==\s*input\.razorpaySignature/,
    );
    expect(source).not.toMatch(
      /expectedSignature\s*===\s*input\.razorpaySignature/,
    );
  });
});
