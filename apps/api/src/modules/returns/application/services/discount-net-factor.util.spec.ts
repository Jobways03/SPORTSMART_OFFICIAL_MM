import { computeOrderDiscountNetFactor } from './discount-net-factor.util';

describe('computeOrderDiscountNetFactor', () => {
  // Regression: SM20260000026 — customer paid ₹818.10 (₹909 − ₹90.90
  // AMOUNT_OFF_ORDER coupon), no shipping. Pre-fix the return refunded the full
  // gross ₹909; the factor must scale ₹909 → ₹818.10.
  it('scales a 10% coupon order to net-paid (the reported over-refund)', () => {
    const factor = computeOrderDiscountNetFactor({
      totalPaise: 81810, // ₹818.10 charged
      discountPaise: 9090, // ₹90.90 off
      shippingPaise: 0,
    });
    expect(factor).toBeCloseTo(0.9, 6);
    // gross line ₹909 → net refund ₹818.10
    expect(Math.round(90900 * factor)).toBe(81810);
  });

  it('returns 1 when there is no discount (gross refund unchanged)', () => {
    expect(
      computeOrderDiscountNetFactor({
        totalPaise: 90900,
        discountPaise: 0,
        shippingPaise: 0,
      }),
    ).toBe(1);
  });

  it('excludes shipping so a shipping fee cannot dilute the ratio', () => {
    // subtotal ₹909, discount ₹90.90, shipping ₹100 → total ₹918.10.
    // Correct net factor is still (909 − 90.90)/909 = 0.90, NOT
    // (918.10)/(1009) = 0.910 which would over-refund.
    const factor = computeOrderDiscountNetFactor({
      totalPaise: 91810, // 90900 − 9090 + 10000
      discountPaise: 9090,
      shippingPaise: 10000,
    });
    expect(factor).toBeCloseTo(0.9, 6);
    expect(Math.round(90900 * factor)).toBe(81810);
  });

  it('handles a full (100%) discount → factor 0', () => {
    // subtotal ₹100, discount ₹100, customer paid ₹0.
    const factor = computeOrderDiscountNetFactor({
      totalPaise: 0,
      discountPaise: 10000,
      shippingPaise: 0,
    });
    expect(factor).toBe(0);
  });

  it('returns 1 for a degenerate (non-positive) pre-discount subtotal', () => {
    expect(
      computeOrderDiscountNetFactor({
        totalPaise: 0,
        discountPaise: 0,
        shippingPaise: 0,
      }),
    ).toBe(1);
  });

  it('clamps to [0,1] against malformed totals', () => {
    // discount larger than the whole order should never yield a negative
    // refund — clamp at 0.
    const factor = computeOrderDiscountNetFactor({
      totalPaise: -5000,
      discountPaise: 10000,
      shippingPaise: 0,
    });
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('tolerates NaN/garbage inputs by treating them as 0 → factor 1', () => {
    expect(
      computeOrderDiscountNetFactor({
        totalPaise: Number('nope'),
        discountPaise: Number('nope'),
        shippingPaise: Number('nope'),
      }),
    ).toBe(1);
  });
});
