// Phase B (P0) — GST calculator tests.
//
// Most-important rule: GST is calculated on the post-discount
// taxable value, not the gross. Wrong allocation → wrong GST →
// non-compliant invoice. Cover the spec's worked examples and a
// handful of rounding edge cases.

import { calculateGstReversal, calculateLineGst } from './calculate-gst';

describe('calculateLineGst — intra-state (CGST + SGST)', () => {
  it('₹1,000 gross, ₹200 discount, 18% → taxable ₹800, CGST ₹72, SGST ₹72, line total ₹944 (spec example)', () => {
    const r = calculateLineGst({
      grossInPaise: 100_000n,
      discountInPaise: 20_000n,
      gstRateBps: 1800,
      isIntraState: true,
    });
    expect(r.taxableInPaise).toBe(80_000n);
    expect(r.cgstInPaise).toBe(7_200n);
    expect(r.sgstInPaise).toBe(7_200n);
    expect(r.igstInPaise).toBe(0n);
    expect(r.totalTaxInPaise).toBe(14_400n);
    expect(r.lineTotalInPaise).toBe(94_400n);
  });

  it('₹1,000 gross, NO discount, 18% → taxable ₹1,000, total tax ₹180, line total ₹1,180', () => {
    const r = calculateLineGst({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      isIntraState: true,
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.totalTaxInPaise).toBe(18_000n);
    expect(r.lineTotalInPaise).toBe(118_000n);
  });

  it('100% discount (free item) → taxable 0, all tax 0, line total 0', () => {
    const r = calculateLineGst({
      grossInPaise: 50_000n,
      discountInPaise: 50_000n,
      gstRateBps: 1800,
      isIntraState: true,
    });
    expect(r.taxableInPaise).toBe(0n);
    expect(r.cgstInPaise).toBe(0n);
    expect(r.sgstInPaise).toBe(0n);
    expect(r.totalTaxInPaise).toBe(0n);
    expect(r.lineTotalInPaise).toBe(0n);
  });

  it('5% rate (essential goods)', () => {
    const r = calculateLineGst({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 500,
      isIntraState: true,
    });
    // 5% of ₹1,000 = ₹50 → CGST 250, SGST 250 (₹2.50 each).
    expect(r.cgstInPaise).toBe(2_500n);
    expect(r.sgstInPaise).toBe(2_500n);
  });

  it('28% rate (luxury)', () => {
    const r = calculateLineGst({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 2800,
      isIntraState: true,
    });
    // 28% of ₹1,000 = ₹280 → CGST 14000, SGST 14000.
    expect(r.cgstInPaise).toBe(14_000n);
    expect(r.sgstInPaise).toBe(14_000n);
  });
});

describe('calculateLineGst — inter-state (IGST)', () => {
  it('₹1,000 gross, ₹200 discount, 18% → taxable ₹800, IGST ₹144, line total ₹944', () => {
    const r = calculateLineGst({
      grossInPaise: 100_000n,
      discountInPaise: 20_000n,
      gstRateBps: 1800,
      isIntraState: false,
    });
    expect(r.taxableInPaise).toBe(80_000n);
    expect(r.cgstInPaise).toBe(0n);
    expect(r.sgstInPaise).toBe(0n);
    expect(r.igstInPaise).toBe(14_400n);
    expect(r.totalTaxInPaise).toBe(14_400n);
    expect(r.lineTotalInPaise).toBe(94_400n);
  });
});

describe('calculateLineGst — invariants', () => {
  it('cgst + sgst + igst === totalTax (always)', () => {
    const cases = [
      { gross: 100_000n, discount: 0n, rate: 500, intra: true },
      { gross: 100_000n, discount: 20_000n, rate: 1800, intra: true },
      { gross: 100_000n, discount: 20_000n, rate: 1800, intra: false },
      { gross: 333_333n, discount: 11_111n, rate: 1200, intra: true },
      { gross: 999_999_999n, discount: 1n, rate: 2800, intra: false },
    ];
    for (const c of cases) {
      const r = calculateLineGst({
        grossInPaise: c.gross,
        discountInPaise: c.discount,
        gstRateBps: c.rate,
        isIntraState: c.intra,
      });
      expect(r.cgstInPaise + r.sgstInPaise + r.igstInPaise).toBe(
        r.totalTaxInPaise,
      );
    }
  });

  it('lineTotal === taxable + totalTax', () => {
    const r = calculateLineGst({
      grossInPaise: 123_456n,
      discountInPaise: 12_345n,
      gstRateBps: 1800,
      isIntraState: true,
    });
    expect(r.lineTotalInPaise).toBe(r.taxableInPaise + r.totalTaxInPaise);
  });

  it('rejects negative gross', () => {
    expect(() =>
      calculateLineGst({
        grossInPaise: -1n,
        discountInPaise: 0n,
        gstRateBps: 1800,
        isIntraState: true,
      }),
    ).toThrow(/negative/);
  });

  it('rejects discount exceeding gross', () => {
    expect(() =>
      calculateLineGst({
        grossInPaise: 100n,
        discountInPaise: 200n,
        gstRateBps: 1800,
        isIntraState: true,
      }),
    ).toThrow(/cannot exceed/);
  });

  it('handles BigInt amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const r = calculateLineGst({
      grossInPaise: 10_000_000_000_000n, // ₹10 crore
      discountInPaise: 1_000_000_000_000n, // ₹1 crore
      gstRateBps: 1800,
      isIntraState: false,
    });
    expect(r.taxableInPaise).toBe(9_000_000_000_000n);
    expect(r.igstInPaise).toBe(1_620_000_000_000n);
    expect(r.lineTotalInPaise).toBe(10_620_000_000_000n);
  });
});

describe('calculateGstReversal — partial returns', () => {
  it('full return: refund equals what customer paid (spec partial-quantity example)', () => {
    // Customer bought 3 units of ₹1,000 each. Discount ₹300. 18% GST.
    // Snapshot: gross 300_000, discount 30_000, taxable 270_000.
    // CGST 24300, SGST 24300, IGST 0. Customer paid 270_000 + 48_600 = 318_600.
    //
    // Returns 3/3 → full reversal.
    const r = calculateGstReversal({
      originalGrossInPaise: 300_000n,
      originalDiscountInPaise: 30_000n,
      originalCgstInPaise: 24_300n,
      originalSgstInPaise: 24_300n,
      originalIgstInPaise: 0n,
      purchasedQuantity: 3,
      returnedQuantity: 3,
    });
    expect(r.grossReturnedInPaise).toBe(300_000n);
    expect(r.discountReversalInPaise).toBe(30_000n);
    expect(r.taxableReversalInPaise).toBe(270_000n);
    expect(r.cgstReversalInPaise).toBe(24_300n);
    expect(r.sgstReversalInPaise).toBe(24_300n);
    expect(r.totalTaxReversalInPaise).toBe(48_600n);
    expect(r.totalCreditNoteInPaise).toBe(318_600n);
  });

  it('partial return: 2 of 3 units (spec example) → ₹1,800 taxable + ₹324 GST = ₹2,124', () => {
    const r = calculateGstReversal({
      originalGrossInPaise: 300_000n,
      originalDiscountInPaise: 30_000n,
      originalCgstInPaise: 0n,
      originalSgstInPaise: 0n,
      originalIgstInPaise: 48_600n, // inter-state
      purchasedQuantity: 3,
      returnedQuantity: 2,
    });
    expect(r.grossReturnedInPaise).toBe(200_000n); // ₹2,000
    expect(r.discountReversalInPaise).toBe(20_000n); // ₹200
    expect(r.taxableReversalInPaise).toBe(180_000n); // ₹1,800
    expect(r.igstReversalInPaise).toBe(32_400n); // ₹324
    expect(r.totalCreditNoteInPaise).toBe(212_400n); // ₹2,124
  });

  it('BXGY free item: zero discount reversal, zero tax reversal (customer paid ₹0)', () => {
    const r = calculateGstReversal({
      originalGrossInPaise: 50_000n, // ₹500 gross
      originalDiscountInPaise: 50_000n, // 100% discount → free
      originalCgstInPaise: 0n,
      originalSgstInPaise: 0n,
      originalIgstInPaise: 0n,
      purchasedQuantity: 1,
      returnedQuantity: 1,
    });
    expect(r.taxableReversalInPaise).toBe(0n);
    expect(r.totalTaxReversalInPaise).toBe(0n);
    expect(r.totalCreditNoteInPaise).toBe(0n);
  });

  it('rejects returnedQuantity > purchasedQuantity', () => {
    expect(() =>
      calculateGstReversal({
        originalGrossInPaise: 100n,
        originalDiscountInPaise: 0n,
        originalCgstInPaise: 0n,
        originalSgstInPaise: 0n,
        originalIgstInPaise: 0n,
        purchasedQuantity: 1,
        returnedQuantity: 5,
      }),
    ).toThrow(/cannot exceed/);
  });

  it('rejects zero or negative returnedQuantity', () => {
    expect(() =>
      calculateGstReversal({
        originalGrossInPaise: 100n,
        originalDiscountInPaise: 0n,
        originalCgstInPaise: 0n,
        originalSgstInPaise: 0n,
        originalIgstInPaise: 0n,
        purchasedQuantity: 1,
        returnedQuantity: 0,
      }),
    ).toThrow();
  });
});
