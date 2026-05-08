import * as crypto from 'crypto';
import { verifyRazorpaySignature } from './razorpay-signature';

const KEY = 'rzp_test_secret_min32chars_for_test_run';

function sign(orderId: string, paymentId: string, key = KEY) {
  return crypto
    .createHmac('sha256', key)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

describe('verifyRazorpaySignature', () => {
  const orderId = 'order_test123';
  const paymentId = 'pay_test456';
  const validSig = sign(orderId, paymentId);

  it('returns true for a correct signature', () => {
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSig,
        keySecret: KEY,
      }),
    ).toBe(true);
  });

  it('returns false for an incorrect signature (different order id)', () => {
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: 'order_other',
        razorpayPaymentId: paymentId,
        razorpaySignature: validSig,
        keySecret: KEY,
      }),
    ).toBe(false);
  });

  it('returns false for an incorrect signature (different payment id)', () => {
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: 'pay_other',
        razorpaySignature: validSig,
        keySecret: KEY,
      }),
    ).toBe(false);
  });

  it('returns false when the signature is the wrong length (no timing leak via length)', () => {
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: 'a',
        keySecret: KEY,
      }),
    ).toBe(false);
  });

  it('returns false for a tampered signature (single byte flip)', () => {
    const tampered =
      validSig.slice(0, -1) + (validSig.endsWith('0') ? '1' : '0');
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: tampered,
        keySecret: KEY,
      }),
    ).toBe(false);
  });

  it('returns false for an empty key (fail-closed against blank-secret bypass)', () => {
    // hmac('', x) is deterministic and publicly reproducible.
    const blankKeySig = sign(orderId, paymentId, '');
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: blankKeySig,
        keySecret: '',
      }),
    ).toBe(false);
  });

  it('returns false when signed with a different key', () => {
    const otherSig = sign(orderId, paymentId, 'different_key_min32_chars_padding');
    expect(
      verifyRazorpaySignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: otherSig,
        keySecret: KEY,
      }),
    ).toBe(false);
  });
});
