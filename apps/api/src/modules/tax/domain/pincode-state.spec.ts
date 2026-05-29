// Phase 89 (2026-05-23) — pincode → GST state code derivation.

import { deriveStateCodeFromPincode } from './pincode-state';

describe('deriveStateCodeFromPincode', () => {
  it('Delhi 110xxx → 07', () => {
    expect(deriveStateCodeFromPincode('110001')?.stateCode).toBe('07');
  });

  it('Karnataka 56xxxx → 29', () => {
    expect(deriveStateCodeFromPincode('560001')?.stateCode).toBe('29');
    expect(deriveStateCodeFromPincode('570001')?.stateCode).toBe('29');
  });

  it('Maharashtra 40xxxx → 27', () => {
    expect(deriveStateCodeFromPincode('400001')?.stateCode).toBe('27');
    expect(deriveStateCodeFromPincode('440001')?.stateCode).toBe('27');
  });

  it('Tamil Nadu 60xxxx → 33', () => {
    expect(deriveStateCodeFromPincode('600001')?.stateCode).toBe('33');
  });

  it('West Bengal 70xxxx → 19', () => {
    expect(deriveStateCodeFromPincode('700001')?.stateCode).toBe('19');
  });

  it('Bihar 80xxxx → 10', () => {
    expect(deriveStateCodeFromPincode('800001')?.stateCode).toBe('10');
  });

  it('Gujarat 38xxxx → 24', () => {
    expect(deriveStateCodeFromPincode('380001')?.stateCode).toBe('24');
  });

  it('Punjab 14xxxx → 03', () => {
    expect(deriveStateCodeFromPincode('140001')?.stateCode).toBe('03');
  });

  it('returns null for malformed input', () => {
    expect(deriveStateCodeFromPincode(null)).toBeNull();
    expect(deriveStateCodeFromPincode('')).toBeNull();
    expect(deriveStateCodeFromPincode('not-a-pin')).toBeNull();
    expect(deriveStateCodeFromPincode('12345')).toBeNull(); // 5 digits
    expect(deriveStateCodeFromPincode('1234567')).toBeNull(); // 7 digits
  });

  it('returns null for unrecognised prefix (e.g. army APO 9xxxxx)', () => {
    expect(deriveStateCodeFromPincode('900001')).toBeNull();
  });
});
