import 'reflect-metadata';
import {
  calculateLineTax,
  TaxEngineError,
} from '../../src/modules/tax/domain/tax-engine';

// Phase 3 GST — tax engine v2 tests.

describe('calculateLineTax — EXCLUSIVE pricing', () => {
  it('₹1000 gross + 18% IGST + no discount = ₹1180 line total', () => {
    const r = calculateLineTax({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      priceIncludesTax: false,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.igstInPaise).toBe(18_000n);
    expect(r.cgstInPaise).toBe(0n);
    expect(r.sgstInPaise).toBe(0n);
    expect(r.totalTaxInPaise).toBe(18_000n);
    expect(r.lineTotalInPaise).toBe(118_000n);
    expect(r.taxSplitType).toBe('IGST');
    expect(r.pricingMode).toBe('EXCLUSIVE');
  });

  it('₹1000 gross + 18% CGST+SGST intra-state', () => {
    const r = calculateLineTax({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      priceIncludesTax: false,
      isIntraState: true,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.cgstInPaise).toBe(9_000n);
    expect(r.sgstInPaise).toBe(9_000n);
    expect(r.igstInPaise).toBe(0n);
    expect(r.totalTaxInPaise).toBe(18_000n);
    expect(r.lineTotalInPaise).toBe(118_000n);
    expect(r.taxSplitType).toBe('CGST_SGST');
  });

  it('discount reduces taxable value before GST', () => {
    // ₹1000 gross − ₹100 discount = ₹900 taxable → ₹162 IGST = ₹1062
    const r = calculateLineTax({
      grossInPaise: 100_000n,
      discountInPaise: 10_000n,
      gstRateBps: 1800,
      priceIncludesTax: false,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise).toBe(90_000n);
    expect(r.igstInPaise).toBe(16_200n);
    expect(r.lineTotalInPaise).toBe(106_200n);
  });
});

describe('calculateLineTax — INCLUSIVE pricing', () => {
  it('₹1180 inclusive @ 18% IGST → ₹1000 taxable + ₹180 IGST', () => {
    const r = calculateLineTax({
      grossInPaise: 118_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      priceIncludesTax: true,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.igstInPaise).toBe(18_000n);
    expect(r.totalTaxInPaise).toBe(18_000n);
    expect(r.lineTotalInPaise).toBe(118_000n);
    expect(r.pricingMode).toBe('INCLUSIVE');
  });

  it('₹1180 inclusive intra-state @ 18% → ₹1000 + ₹90 CGST + ₹90 SGST', () => {
    const r = calculateLineTax({
      grossInPaise: 118_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      priceIncludesTax: true,
      isIntraState: true,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.cgstInPaise).toBe(9_000n);
    expect(r.sgstInPaise).toBe(9_000n);
    expect(r.totalTaxInPaise).toBe(18_000n);
    expect(r.lineTotalInPaise).toBe(118_000n);
  });

  it('inclusive ₹1180 with ₹118 discount → ₹900 taxable + ₹162 IGST = ₹1062', () => {
    const r = calculateLineTax({
      grossInPaise: 118_000n,
      discountInPaise: 11_800n,
      gstRateBps: 1800,
      priceIncludesTax: true,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    // netInclusive = ₹1062 → taxable = 1062 × 10000/11800 = ₹900 = 90_000 paise
    expect(r.taxableInPaise).toBe(90_000n);
    expect(r.igstInPaise).toBe(16_200n);
    expect(r.lineTotalInPaise).toBe(106_200n);
  });
});

describe('calculateLineTax — taxability taxonomy', () => {
  it('EXEMPT supply produces zero tax and lineTotal = taxable', () => {
    const r = calculateLineTax({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 0,
      priceIncludesTax: false,
      isIntraState: false,
      supplyTaxability: 'EXEMPT',
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.totalTaxInPaise).toBe(0n);
    expect(r.lineTotalInPaise).toBe(100_000n);
    expect(r.reportableValueInPaise).toBe(100_000n);
  });

  it('NIL_RATED produces zero tax and reports separately', () => {
    const r = calculateLineTax({
      grossInPaise: 50_000n,
      discountInPaise: 0n,
      gstRateBps: 0,
      priceIncludesTax: false,
      isIntraState: false,
      supplyTaxability: 'NIL_RATED',
    });
    expect(r.totalTaxInPaise).toBe(0n);
    expect(r.lineTotalInPaise).toBe(50_000n);
    expect(r.supplyTaxability).toBe('NIL_RATED');
  });

  it('NON_GST produces zero tax', () => {
    const r = calculateLineTax({
      grossInPaise: 25_000n,
      discountInPaise: 5_000n,
      gstRateBps: 0,
      priceIncludesTax: false,
      isIntraState: false,
      supplyTaxability: 'NON_GST',
    });
    expect(r.taxableInPaise).toBe(20_000n);
    expect(r.totalTaxInPaise).toBe(0n);
  });

  it('rejects taxable rate > 0 for non-taxable supply', () => {
    expect(() =>
      calculateLineTax({
        grossInPaise: 100_000n,
        discountInPaise: 0n,
        gstRateBps: 1800,
        priceIncludesTax: false,
        isIntraState: false,
        supplyTaxability: 'EXEMPT',
      }),
    ).toThrow(TaxEngineError);
  });
});

describe('calculateLineTax — conservation invariants', () => {
  it('cgst + sgst + igst always equals totalTax', () => {
    const inputs = [
      { gross: 100_000n, discount: 0n, rate: 1800, intra: true, inc: false },
      { gross: 118_000n, discount: 0n, rate: 1800, intra: true, inc: true },
      { gross: 7_777n, discount: 333n, rate: 500, intra: true, inc: false }, // odd values
      { gross: 100_001n, discount: 1n, rate: 2800, intra: false, inc: false },
    ];
    for (const { gross, discount, rate, intra, inc } of inputs) {
      const r = calculateLineTax({
        grossInPaise: gross,
        discountInPaise: discount,
        gstRateBps: rate,
        priceIncludesTax: inc,
        isIntraState: intra,
        supplyTaxability: 'TAXABLE',
      });
      expect(r.cgstInPaise + r.sgstInPaise + r.igstInPaise).toBe(r.totalTaxInPaise);
    }
  });

  it('exclusive: taxable + totalTax === lineTotal (no cess)', () => {
    const r = calculateLineTax({
      grossInPaise: 100_000n,
      discountInPaise: 5_000n,
      gstRateBps: 1200,
      priceIncludesTax: false,
      isIntraState: true,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise + r.totalTaxInPaise).toBe(r.lineTotalInPaise);
  });

  it('inclusive: gross − discount === lineTotal (no cess)', () => {
    const r = calculateLineTax({
      grossInPaise: 118_000n,
      discountInPaise: 10_000n,
      gstRateBps: 1800,
      priceIncludesTax: true,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.grossInPaise - r.discountInPaise).toBe(r.lineTotalInPaise);
  });
});

describe('calculateLineTax — cess', () => {
  it('cess applied on taxable base, exclusive of GST line total', () => {
    // ₹1000 taxable + 18% IGST (₹180) + 5% cess (₹50) = ₹1230 line
    const r = calculateLineTax({
      grossInPaise: 100_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      cessRateBps: 500,
      priceIncludesTax: false,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.cessInPaise).toBe(5_000n);
    expect(r.totalTaxInPaise).toBe(18_000n);
    expect(r.lineTotalInPaise).toBe(123_000n);
  });

  it('cess in inclusive mode is still exclusive (cess does not back out from gross)', () => {
    // ₹1180 inclusive (GST in) + 5% cess on taxable = ₹1230 line total
    const r = calculateLineTax({
      grossInPaise: 118_000n,
      discountInPaise: 0n,
      gstRateBps: 1800,
      cessRateBps: 500,
      priceIncludesTax: true,
      isIntraState: false,
      supplyTaxability: 'TAXABLE',
    });
    expect(r.taxableInPaise).toBe(100_000n);
    expect(r.cessInPaise).toBe(5_000n);
    expect(r.lineTotalInPaise).toBe(123_000n);
  });
});

describe('calculateLineTax — input validation', () => {
  it('rejects negative gross', () => {
    expect(() =>
      calculateLineTax({
        grossInPaise: -1n,
        discountInPaise: 0n,
        gstRateBps: 1800,
        priceIncludesTax: false,
        isIntraState: false,
        supplyTaxability: 'TAXABLE',
      }),
    ).toThrow(TaxEngineError);
  });

  it('rejects discount exceeding gross', () => {
    expect(() =>
      calculateLineTax({
        grossInPaise: 1000n,
        discountInPaise: 2000n,
        gstRateBps: 1800,
        priceIncludesTax: false,
        isIntraState: false,
        supplyTaxability: 'TAXABLE',
      }),
    ).toThrow(TaxEngineError);
  });

  it('rejects non-integer / negative rate', () => {
    expect(() =>
      calculateLineTax({
        grossInPaise: 1000n,
        discountInPaise: 0n,
        gstRateBps: -100,
        priceIncludesTax: false,
        isIntraState: false,
        supplyTaxability: 'TAXABLE',
      }),
    ).toThrow(TaxEngineError);
  });

  it('rejects invalid taxability string', () => {
    expect(() =>
      calculateLineTax({
        grossInPaise: 1000n,
        discountInPaise: 0n,
        gstRateBps: 0,
        priceIncludesTax: false,
        isIntraState: false,
        supplyTaxability: 'BOGUS' as any,
      }),
    ).toThrow(TaxEngineError);
  });
});
