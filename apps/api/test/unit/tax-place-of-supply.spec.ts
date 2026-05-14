import 'reflect-metadata';
import {
  resolvePlaceOfSupply,
  PlaceOfSupplyResolutionError,
} from '../../src/modules/tax/domain/place-of-supply';
import {
  normalizeStateName,
  lookupStateCodeByName,
  extractStateCodeFromAddress,
  buildStateIndex,
} from '../../src/modules/tax/domain/state-code-map';

// Phase 2 GST — pure-function tests for place-of-supply resolution.

describe('resolvePlaceOfSupply', () => {
  it('returns CGST_SGST when supplier and customer states match', () => {
    const r = resolvePlaceOfSupply({
      supplierStateCode: '29',
      customerShippingStateCode: '29',
    });
    expect(r.isIntraState).toBe(true);
    expect(r.taxSplitType).toBe('CGST_SGST');
    expect(r.placeOfSupplyStateCode).toBe('29');
  });

  it('returns IGST when supplier and customer states differ', () => {
    const r = resolvePlaceOfSupply({
      supplierStateCode: '36', // Telangana seller
      customerShippingStateCode: '29', // Karnataka customer
    });
    expect(r.isIntraState).toBe(false);
    expect(r.taxSplitType).toBe('IGST');
    expect(r.placeOfSupplyStateCode).toBe('29');
  });

  it('B2C default — POS = shipping state regardless of billing/GSTIN', () => {
    const r = resolvePlaceOfSupply({
      supplierStateCode: '36',
      customerShippingStateCode: '07',  // Delhi
      customerBillingStateCode: '27',   // Maharashtra
      customerGstinStateCode: '27',
      invoiceType: 'B2C',
    });
    expect(r.placeOfSupplyStateCode).toBe('07');
    expect(r.resolutionReason).toMatch(/B2C/);
  });

  it('B2B with SHIPPING source — POS = shipping state', () => {
    const r = resolvePlaceOfSupply({
      supplierStateCode: '36',
      customerShippingStateCode: '07',
      customerGstinStateCode: '27',
      invoiceType: 'B2B',
      posSourceForB2b: 'SHIPPING',
    });
    expect(r.placeOfSupplyStateCode).toBe('07');
    expect(r.resolutionReason).toMatch(/shipping-state/);
  });

  it('B2B with BUYER_GSTIN_STATE source — POS = buyer GSTIN state', () => {
    const r = resolvePlaceOfSupply({
      supplierStateCode: '36',
      customerShippingStateCode: '07',
      customerGstinStateCode: '27',
      invoiceType: 'B2B',
      posSourceForB2b: 'BUYER_GSTIN_STATE',
    });
    expect(r.placeOfSupplyStateCode).toBe('27');
    expect(r.resolutionReason).toMatch(/buyer GSTIN state/);
  });

  it('rejects invalid state codes', () => {
    expect(() =>
      resolvePlaceOfSupply({
        supplierStateCode: 'XX',
        customerShippingStateCode: '29',
      }),
    ).toThrow(PlaceOfSupplyResolutionError);

    expect(() =>
      resolvePlaceOfSupply({
        supplierStateCode: '29',
        customerShippingStateCode: '',
      }),
    ).toThrow(PlaceOfSupplyResolutionError);
  });

  it('rejects single-digit state codes', () => {
    expect(() =>
      resolvePlaceOfSupply({
        supplierStateCode: '1',
        customerShippingStateCode: '29',
      }),
    ).toThrow(PlaceOfSupplyResolutionError);
  });

  it('accepts special state codes (96/97/99)', () => {
    const r = resolvePlaceOfSupply({
      supplierStateCode: '29',
      customerShippingStateCode: '96', // Other Country
    });
    expect(r.isIntraState).toBe(false);
    expect(r.taxSplitType).toBe('IGST');
  });
});

describe('normalizeStateName', () => {
  it('uppercases + trims + collapses whitespace', () => {
    expect(normalizeStateName('  karnataka  ')).toBe('KARNATAKA');
    expect(normalizeStateName('Tamil   Nadu')).toBe('TAMIL NADU');
  });

  it('handles empty / null / undefined', () => {
    expect(normalizeStateName(null)).toBe('');
    expect(normalizeStateName(undefined)).toBe('');
    expect(normalizeStateName('')).toBe('');
  });
});

describe('lookupStateCodeByName', () => {
  const index = buildStateIndex([
    { gstStateCode: '29', stateName: 'Karnataka' },
    { gstStateCode: '36', stateName: 'Telangana' },
    { gstStateCode: '33', stateName: 'Tamil Nadu' },
  ]);

  it('finds by exact name', () => {
    expect(lookupStateCodeByName('Karnataka', index)).toBe('29');
  });

  it('finds case-insensitive', () => {
    expect(lookupStateCodeByName('karnataka', index)).toBe('29');
    expect(lookupStateCodeByName('TAMIL NADU', index)).toBe('33');
  });

  it('returns null for unknown', () => {
    expect(lookupStateCodeByName('Atlantis', index)).toBeNull();
    expect(lookupStateCodeByName(null, index)).toBeNull();
  });
});

describe('extractStateCodeFromAddress', () => {
  const index = buildStateIndex([
    { gstStateCode: '29', stateName: 'Karnataka' },
    { gstStateCode: '36', stateName: 'Telangana' },
  ]);

  it('prefers explicit stateCode field', () => {
    const r = extractStateCodeFromAddress(
      { stateCode: '29', state: 'Telangana' /* mismatch */ },
      index,
    );
    expect(r.stateCode).toBe('29');
    expect(r.source).toBe('stateCode');
  });

  it('falls back to gstStateCode', () => {
    const r = extractStateCodeFromAddress({ gstStateCode: '36' }, index);
    expect(r.stateCode).toBe('36');
    expect(r.source).toBe('gstStateCode');
  });

  it('falls back to state-name lookup', () => {
    const r = extractStateCodeFromAddress({ state: 'Karnataka' }, index);
    expect(r.stateCode).toBe('29');
    expect(r.source).toBe('stateName');
  });

  it('returns null when no field matches', () => {
    const r = extractStateCodeFromAddress({ state: 'Atlantis' }, index);
    expect(r.stateCode).toBeNull();
    expect(r.source).toBeNull();
  });

  it('handles non-object input gracefully', () => {
    expect(extractStateCodeFromAddress(null, index)).toEqual({ stateCode: null, source: null });
    expect(extractStateCodeFromAddress(undefined, index)).toEqual({ stateCode: null, source: null });
    expect(extractStateCodeFromAddress('not-an-object', index)).toEqual({ stateCode: null, source: null });
  });

  it('rejects malformed stateCode values', () => {
    // Three-digit string is not a valid GST code; should fall through
    const r = extractStateCodeFromAddress({ stateCode: '290', state: 'Karnataka' }, index);
    expect(r.stateCode).toBe('29'); // fell through to state-name lookup
    expect(r.source).toBe('stateName');
  });
});
