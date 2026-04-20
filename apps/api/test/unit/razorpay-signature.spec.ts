import * as crypto from 'crypto';

/**
 * Razorpay webhook signature verification — pure-crypto unit test.
 *
 * The verification logic in
 * `src/modules/payments/presentation/controllers/payment-webhook.controller.ts`
 * is private to the controller class, so we re-implement the algorithm here
 * and assert it matches what Razorpay expects. If the controller's
 * implementation diverges (e.g. someone changes the hash algo or comparison)
 * this test pins the spec down.
 *
 * Reference: https://razorpay.com/docs/webhooks/validate-test/#validate-webhook-signature
 */

function verifyRazorpaySignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

describe('Razorpay webhook signature verification', () => {
  const SECRET = 'test-webhook-secret';

  it('accepts a correctly-signed payload', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_test123' } } },
      }),
    );
    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(body)
      .digest('hex');

    expect(verifyRazorpaySignature(body, signature, SECRET)).toBe(true);
  });

  it('rejects a payload with the wrong signature', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    const wrongSignature = 'a'.repeat(64); // hex-shaped but garbage

    expect(verifyRazorpaySignature(body, wrongSignature, SECRET)).toBe(false);
  });

  it('rejects a payload signed with a different secret', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    const signatureWithWrongSecret = crypto
      .createHmac('sha256', 'attacker-secret')
      .update(body)
      .digest('hex');

    expect(verifyRazorpaySignature(body, signatureWithWrongSecret, SECRET)).toBe(
      false,
    );
  });

  it('rejects a payload where the body has been tampered with', () => {
    const originalBody = Buffer.from('{"amount":100}');
    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(originalBody)
      .digest('hex');
    const tamperedBody = Buffer.from('{"amount":1000}');

    expect(verifyRazorpaySignature(tamperedBody, signature, SECRET)).toBe(false);
  });

  it('rejects a signature with the wrong length (timing-safe guard)', () => {
    const body = Buffer.from('{}');
    const tooShort = 'abc';
    const tooLong = 'a'.repeat(128);

    expect(verifyRazorpaySignature(body, tooShort, SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, tooLong, SECRET)).toBe(false);
  });

  it('handles empty body correctly', () => {
    const body = Buffer.from('');
    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(body)
      .digest('hex');

    expect(verifyRazorpaySignature(body, signature, SECRET)).toBe(true);
  });
});
