import { BadRequestAppException } from '../exceptions';
import {
  assertGatewayPaymentMatchesOrder,
  GatewayPaymentSnapshot,
  ExpectedOrder,
} from './gateway-amount-verifier';

const validPayment: GatewayPaymentSnapshot = {
  amount: 1_000_000, // ₹10,000 in paise
  status: 'captured',
  captured: true,
  order_id: 'order_test123',
};

const validExpected: ExpectedOrder = {
  totalAmountInPaise: 1_000_000n,
  razorpayOrderId: 'order_test123',
};

describe('assertGatewayPaymentMatchesOrder', () => {
  it('passes when every field matches', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(validPayment, validExpected),
    ).not.toThrow();
  });

  // ── status / captured ──────────────────────────────────────────────

  it('rejects an authorized-but-not-captured payment', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, status: 'authorized', captured: false },
        validExpected,
      ),
    ).toThrow(BadRequestAppException);
    try {
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, status: 'authorized', captured: false },
        validExpected,
      );
    } catch (e: any) {
      expect(e.code).toBe('GATEWAY_PAYMENT_NOT_CAPTURED');
    }
  });

  it('rejects when status is captured but captured=false (impossible combo)', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, captured: false },
        validExpected,
      ),
    ).toThrow(/not yet captured/);
  });

  it('rejects a failed status', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, status: 'failed' },
        validExpected,
      ),
    ).toThrow(/not yet captured/);
  });

  // ── order_id binding ───────────────────────────────────────────────

  it('rejects when order_id is for a different Razorpay order', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, order_id: 'order_other' },
        validExpected,
      ),
    ).toThrow(BadRequestAppException);
    try {
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, order_id: 'order_other' },
        validExpected,
      );
    } catch (e: any) {
      expect(e.code).toBe('GATEWAY_ORDER_ID_MISMATCH');
    }
  });

  // ── amount comparison ──────────────────────────────────────────────

  it('rejects an under-payment (the headline silent-loss case)', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, amount: 100 }, // ₹1 paid for a ₹10,000 order
        validExpected,
      ),
    ).toThrow(BadRequestAppException);
    try {
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, amount: 100 },
        validExpected,
      );
    } catch (e: any) {
      expect(e.code).toBe('GATEWAY_AMOUNT_MISMATCH');
      expect(e.message).toContain('100 paise');
      expect(e.message).toContain('1000000 paise');
    }
  });

  it('rejects an over-payment', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, amount: 1_000_001 }, // 1 paise over
        validExpected,
      ),
    ).toThrow(/AMOUNT_MISMATCH|amount mismatch/i);
  });

  it('accepts a number amount equal to the expected bigint', () => {
    // Razorpay's response gives `amount: number`. The helper must coerce.
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, amount: 1_000_000 },
        validExpected,
      ),
    ).not.toThrow();
  });

  it('accepts a bigint amount equal to the expected bigint (large value)', () => {
    // Above 2^53 paise — Number would lose precision; BigInt does not.
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, amount: huge },
        { ...validExpected, totalAmountInPaise: huge },
      ),
    ).not.toThrow();
  });

  it('rejects off-by-one paise', () => {
    expect(() =>
      assertGatewayPaymentMatchesOrder(
        { ...validPayment, amount: 999_999 },
        validExpected,
      ),
    ).toThrow(/AMOUNT_MISMATCH|amount mismatch/i);
  });
});
