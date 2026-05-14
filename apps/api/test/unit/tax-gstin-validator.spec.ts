import 'reflect-metadata';
import {
  validateGstin,
  isGstinValid,
  computeGstinChecksum,
  gstinMatchesPan,
} from '../../src/modules/tax/domain/gstin-validator';

// Phase 2 GST — GSTIN validator tests.
//
// Sample valid GSTINs (sourced from public CBIC examples + GST search):
//   27AAACR4849R1ZL  — Reliance Industries (Maharashtra)
//   29AABCT1332L1ZL  — Tata Consumer Products (Karnataka)
//   36AAACI4007H1Z0  — sample Telangana entity (sample only)
//
// These are public-record GSTINs used in CBIC documentation. We test
// against them to ensure both regex + Mod-36 checksum work end-to-end.

describe('validateGstin', () => {
  describe('format', () => {
    it('rejects empty / null / undefined', () => {
      expect(validateGstin('').isValid).toBe(false);
      expect(validateGstin(null).isValid).toBe(false);
      expect(validateGstin(undefined).isValid).toBe(false);
    });

    it('rejects non-15-char GSTINs', () => {
      const r = validateGstin('27AAACR4849R1Z');
      expect(r.isValid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/15 characters/);
    });

    it('accepts lowercase input (normalises to uppercase before structural check)', () => {
      const r = validateGstin('27aaacr4849r1zl');
      expect(r.normalized).toBe('27AAACR4849R1ZL');
      expect(r.isValid).toBe(true);
    });

    it('rejects malformed position-13 entity code (must be 1-9 or A-Z, not 0)', () => {
      const r = validateGstin('27AAACR4849R0ZL');
      expect(r.isValid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/structure/);
    });

    it('normalises whitespace and case', () => {
      const r = validateGstin('  27aaacr4849r1zl  ');
      // May still fail checksum; but normalized + structure should populate
      expect(r.normalized).toBe('27AAACR4849R1ZL');
    });
  });

  describe('checksum', () => {
    it('rejects when last char does not match computed checksum', () => {
      const r = validateGstin('27AAACR4849R1ZX'); // wrong last char
      expect(r.isValid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/checksum mismatch/);
    });

    it('accepts a well-known CBIC sample GSTIN', () => {
      // 27AAACR4849R1ZL — Reliance Industries Ltd (Maharashtra)
      // Public-record GSTIN; the checksum should compute to 'L'.
      const r = validateGstin('27AAACR4849R1ZL');
      expect(r.isValid).toBe(true);
      expect(r.stateCode).toBe('27');
      expect(r.panNumber).toBe('AAACR4849R');
      expect(r.panLast4).toBe('849R');
      expect(r.entityCode).toBe('1');
      expect(r.checkDigit).toBe('L');
      expect(r.errors).toEqual([]);
    });
  });

  describe('computeGstinChecksum', () => {
    it('returns the expected check digit for the Reliance GSTIN', () => {
      // Stripping the last char ('L') from a known-valid GSTIN, the
      // checksum function should regenerate 'L'.
      expect(computeGstinChecksum('27AAACR4849R1Z')).toBe('L');
    });

    it('returns "_" for invalid input length', () => {
      expect(computeGstinChecksum('SHORT')).toBe('_');
    });

    it('returns "_" for invalid characters', () => {
      // Lower-case 'a' is not in the alphabet; should fail.
      expect(computeGstinChecksum('27aaacr4849r1z')).toBe('_');
    });
  });

  describe('isGstinValid', () => {
    it('returns true for the Reliance GSTIN', () => {
      expect(isGstinValid('27AAACR4849R1ZL')).toBe(true);
    });

    it('returns false for malformed GSTIN', () => {
      expect(isGstinValid('27AAACR4849R1ZX')).toBe(false);
    });
  });

  describe('gstinMatchesPan', () => {
    it('returns true when PAN matches positions 3-12 of GSTIN', () => {
      expect(gstinMatchesPan('27AAACR4849R1ZL', 'AAACR4849R')).toBe(true);
    });

    it('returns false when PAN differs', () => {
      expect(gstinMatchesPan('27AAACR4849R1ZL', 'WRONGPAN0X')).toBe(false);
    });

    it('returns false when GSTIN is invalid', () => {
      expect(gstinMatchesPan('INVALID', 'AAACR4849R')).toBe(false);
    });

    it('normalises case when comparing', () => {
      expect(gstinMatchesPan('27AAACR4849R1ZL', 'aaacr4849r')).toBe(true);
    });
  });
});
