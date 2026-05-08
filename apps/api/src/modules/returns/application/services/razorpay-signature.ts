import * as crypto from 'crypto';

/**
 * Phase 13 (P1.14 follow-up) — Razorpay signature verifier shared by
 * checkout and the exchange-payment-collection flow.
 *
 * Razorpay's verify-payment signature is `HMAC-SHA256(orderId|paymentId)`
 * keyed by the API key_secret. Comparing in constant time prevents
 * byte-position timing leakage on the HMAC. Pure function so unit
 * tests can stub `keySecret` and exercise the branches without DI.
 */
export function verifyRazorpaySignature(args: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  keySecret: string;
}): boolean {
  if (!args.keySecret || args.keySecret.length === 0) {
    // Fail closed: hmac('', x) is deterministic and publicly
    // reproducible, so accepting a "matching" signature against a
    // blank key is equivalent to bypassing the check entirely.
    return false;
  }
  const expected = crypto
    .createHmac('sha256', args.keySecret)
    .update(`${args.razorpayOrderId}|${args.razorpayPaymentId}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(args.razorpaySignature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
