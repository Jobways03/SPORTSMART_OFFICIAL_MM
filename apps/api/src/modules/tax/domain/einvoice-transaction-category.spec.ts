// Phase 90 (2026-05-23) — transaction-category resolver coverage.

import { resolveTransactionCategory } from './einvoice-transaction-category';

describe('resolveTransactionCategory', () => {
  it('domestic GSTIN → B2B', () => {
    expect(
      resolveTransactionCategory({
        buyerGstin: '27AAACR5678B1ZL',
        reverseChargeApplicable: false,
      }),
    ).toBe('B2B');
  });

  it('SEZ GSTIN (entity-seq=9) → SEZWP', () => {
    // Position 0-1: state, 2-11: PAN, 12: entity-seq, 13: Z, 14: checksum
    expect(
      resolveTransactionCategory({
        buyerGstin: '27AAACR5678B9ZL',
        reverseChargeApplicable: false,
      }),
    ).toBe('SEZWP');
  });

  it('SEZ + reverse charge → SEZWOP', () => {
    expect(
      resolveTransactionCategory({
        buyerGstin: '27AAACR5678B9ZL',
        reverseChargeApplicable: true,
      }),
    ).toBe('SEZWOP');
  });

  it('null buyer GSTIN → B2B (caller-guard expected)', () => {
    expect(
      resolveTransactionCategory({
        buyerGstin: null,
        reverseChargeApplicable: false,
      }),
    ).toBe('B2B');
  });

  it('malformed GSTIN length → B2B', () => {
    expect(
      resolveTransactionCategory({
        buyerGstin: '27',
        reverseChargeApplicable: false,
      }),
    ).toBe('B2B');
  });
});
