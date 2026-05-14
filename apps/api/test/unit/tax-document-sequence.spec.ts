import 'reflect-metadata';
import { DocumentSequenceService } from '../../src/modules/tax/application/services/document-sequence.service';

// Phase 8 GST — DocumentSequenceService pure-function tests.
// The DB-roundtrip behaviour (atomic upsert + RETURNING) is tested
// via integration in Phase 27; these tests pin the pure helpers
// (financialYearOf, sequenceKeyOf, number formatting via prefix +
// pad width).

describe('DocumentSequenceService.financialYearOf', () => {
  it('1 April 2026 IST → 2026-27', () => {
    // 1 Apr 2026 00:00 IST = 31 Mar 2026 18:30 UTC
    const d = new Date(Date.UTC(2026, 2, 31, 18, 30, 0));
    expect(DocumentSequenceService.financialYearOf(d)).toBe('2026-27');
  });

  it('31 March 2027 IST → 2026-27 (last day of FY)', () => {
    // 31 Mar 2027 23:59 IST = 31 Mar 2027 18:29 UTC
    const d = new Date(Date.UTC(2027, 2, 31, 18, 29, 0));
    expect(DocumentSequenceService.financialYearOf(d)).toBe('2026-27');
  });

  it('1 April 2027 IST → 2027-28 (new FY)', () => {
    // 1 Apr 2027 00:00 IST = 31 Mar 2027 18:30 UTC
    const d = new Date(Date.UTC(2027, 2, 31, 18, 30, 0));
    expect(DocumentSequenceService.financialYearOf(d)).toBe('2027-28');
  });

  it('January 2027 IST → 2026-27', () => {
    const d = new Date(Date.UTC(2027, 0, 15, 0, 0, 0));
    expect(DocumentSequenceService.financialYearOf(d)).toBe('2026-27');
  });

  it('handles century rollover (2099-00)', () => {
    const d = new Date(Date.UTC(2099, 11, 1, 0, 0, 0));
    expect(DocumentSequenceService.financialYearOf(d)).toBe('2099-00');
  });
});

describe('DocumentSequenceService.sequenceKeyOf', () => {
  it('builds key with GSTIN', () => {
    expect(
      DocumentSequenceService.sequenceKeyOf('36ABCDE1234F1Z5', '2026-27', 'TAX_INVOICE'),
    ).toBe('36ABCDE1234F1Z5|2026-27|TAX_INVOICE');
  });

  it('substitutes "PLATFORM" for null GSTIN', () => {
    expect(
      DocumentSequenceService.sequenceKeyOf(null, '2026-27', 'LEGACY_RECEIPT'),
    ).toBe('PLATFORM|2026-27|LEGACY_RECEIPT');
  });

  it('preserves financial year + document type verbatim', () => {
    expect(
      DocumentSequenceService.sequenceKeyOf('29AAACR4849R1ZL', '2099-00', 'CREDIT_NOTE'),
    ).toBe('29AAACR4849R1ZL|2099-00|CREDIT_NOTE');
  });
});
