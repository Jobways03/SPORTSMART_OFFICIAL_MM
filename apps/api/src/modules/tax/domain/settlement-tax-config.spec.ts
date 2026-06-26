import {
  DEFAULT_SETTLEMENT_TAX_CONFIG,
  SETTLEMENT_TAX_BASE_TYPES,
  isSettlementTaxBaseType,
  resolveTaxBaseInPaise,
} from './settlement-tax-config';

// Phase 253 — locks the CA-approved settlement tax model. Each assertion below
// would have FAILED against the pre-Phase-253 code (TCS base 'GST', TDS enabled).
describe('settlement-tax-config (CA-approved model)', () => {
  const bases = {
    commissionInPaise: 47619n, // ₹476.19 commission
    priceOfGoodsSoldInPaise: 500000n, // ₹5000 gross incl GST
    gstInPaise: 8571n, // ₹85.71 commission-GST (the old, wrong §52 base)
    taxableSupplyInPaise: 476190n, // ₹4761.90 net taxable supply (the §52 base)
  };

  it('exposes TAXABLE_SUPPLY as a valid base type', () => {
    expect(SETTLEMENT_TAX_BASE_TYPES).toContain('TAXABLE_SUPPLY');
    expect(isSettlementTaxBaseType('TAXABLE_SUPPLY')).toBe(true);
  });

  it('defaults §52 TCS to the net taxable supply (not commission-GST)', () => {
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.tcs.baseType).toBe('TAXABLE_SUPPLY');
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.tcs.rateBps).toBe(100); // 1%
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.tcs.enabled).toBe(true);
  });

  it('disables §194-O TDS by default (CA model deducts only commission + GST + TCS)', () => {
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.tds.enabled).toBe(false);
  });

  it('keeps commission-GST 18% on commission', () => {
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.gst.rateBps).toBe(1800);
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.gst.baseType).toBe('COMMISSION');
    expect(DEFAULT_SETTLEMENT_TAX_CONFIG.gst.enabled).toBe(true);
  });

  it('routes resolveTaxBaseInPaise to the taxable supply for TAXABLE_SUPPLY', () => {
    expect(resolveTaxBaseInPaise('TAXABLE_SUPPLY', bases)).toBe(476190n);
    expect(resolveTaxBaseInPaise('GST', bases)).toBe(8571n);
    expect(resolveTaxBaseInPaise('COMMISSION', bases)).toBe(47619n);
    expect(resolveTaxBaseInPaise('PRICE_OF_GOODS_SOLD', bases)).toBe(500000n);
  });

  it('yields the CA worked-example §52 TCS of ₹47.62 (1% × taxable, round half-up)', () => {
    const base = resolveTaxBaseInPaise(
      DEFAULT_SETTLEMENT_TAX_CONFIG.tcs.baseType,
      bases,
    );
    // Same round-half-up the TCS hook applies: (base × rateBps + 5000) / 10000.
    const tcs =
      (base * BigInt(DEFAULT_SETTLEMENT_TAX_CONFIG.tcs.rateBps) + 5000n) / 10000n;
    expect(tcs).toBe(4762n); // ₹47.62 — NOT ₹0.86 (1% of the ₹85.71 commission-GST)

    // Net payout = gross settlement (customer − commission) − commission-GST − TCS
    // = (500000 − 47619) − 8571 − 4762 = 439048 paise = ₹4390.48 (CA Step 4).
    const grossSettlement = 500000n - 47619n;
    const net = grossSettlement - 8571n - tcs;
    expect(net).toBe(439048n);
  });
});
