import {
  assertReturnDecisionMatrix,
  mapReturnDecisionToLedger,
} from './return-decision-matrix';
import { BadRequestAppException } from '../../../../core/exceptions';

describe('assertReturnDecisionMatrix', () => {
  describe('happy paths', () => {
    it.each([
      ['QC_APPROVED', 'SELLER', 'FULL_REFUND'],
      ['QC_APPROVED', 'LOGISTICS', 'FULL_REFUND'],
      ['QC_APPROVED', 'PLATFORM', 'FULL_REFUND'],
      ['QC_APPROVED', 'NONE', 'FULL_REFUND'],
      ['QC_APPROVED', 'PLATFORM', 'GOODWILL_CREDIT'],
      ['PARTIALLY_APPROVED', 'SELLER', 'PARTIAL_REFUND'],
      ['PARTIALLY_APPROVED', 'LOGISTICS', 'PARTIAL_REFUND'],
      ['PARTIALLY_APPROVED', 'PLATFORM', 'PARTIAL_REFUND'],
    ] as const)(
      '%s + %s + %s should be allowed',
      (newStatus, liabilityParty, customerRemedy) => {
        expect(() =>
          assertReturnDecisionMatrix({
            newStatus,
            liabilityParty,
            customerRemedy,
          }),
        ).not.toThrow();
      },
    );
  });

  describe('missing fields', () => {
    it('throws when liabilityParty is null', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: null,
          customerRemedy: 'FULL_REFUND',
        }),
      ).toThrow(BadRequestAppException);
    });

    it('throws when customerRemedy is null', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: null,
        }),
      ).toThrow(BadRequestAppException);
    });
  });

  describe('forbidden combos', () => {
    it('rejects PARTIAL_REFUND on a fully approved QC outcome', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: 'PARTIAL_REFUND',
        }),
      ).toThrow(/PARTIAL_REFUND is only valid/);
    });

    it('rejects FULL_REFUND on a partial QC outcome', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'PARTIALLY_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: 'FULL_REFUND',
        }),
      ).toThrow(/FULL_REFUND is not valid/);
    });

    it('rejects GOODWILL_CREDIT paired with SELLER', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: 'GOODWILL_CREDIT',
        }),
      ).toThrow(/GOODWILL_CREDIT must be paid by PLATFORM/);
    });

    it('rejects GOODWILL_CREDIT paired with LOGISTICS', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: 'LOGISTICS',
          customerRemedy: 'GOODWILL_CREDIT',
        }),
      ).toThrow(/GOODWILL_CREDIT must be paid by PLATFORM/);
    });

    it('rejects NO_REFUND when items are approved', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: 'PLATFORM',
          customerRemedy: 'NO_REFUND',
        }),
      ).toThrow(/NO_REFUND is not valid when items are approved/);
    });

    it('rejects REPLACEMENT on partial QC outcome', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'PARTIALLY_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: 'REPLACEMENT',
        }),
      ).toThrow(/REPLACEMENT requires QC_APPROVED/);
    });

    it('rejects EXCHANGE on partial QC outcome', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'PARTIALLY_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: 'EXCHANGE',
        }),
      ).toThrow(/EXCHANGE requires QC_APPROVED/);
    });
  });

  describe('replacement / exchange happy paths', () => {
    it.each(['SELLER', 'PLATFORM', 'LOGISTICS'] as const)(
      'QC_APPROVED + REPLACEMENT + %s liability allowed',
      (liab) => {
        expect(() =>
          assertReturnDecisionMatrix({
            newStatus: 'QC_APPROVED',
            liabilityParty: liab,
            customerRemedy: 'REPLACEMENT',
          }),
        ).not.toThrow();
      },
    );

    it('QC_APPROVED + EXCHANGE + SELLER liability allowed', () => {
      expect(() =>
        assertReturnDecisionMatrix({
          newStatus: 'QC_APPROVED',
          liabilityParty: 'SELLER',
          customerRemedy: 'EXCHANGE',
        }),
      ).not.toThrow();
    });
  });
});

describe('mapReturnDecisionToLedger', () => {
  it('returns SELLER_DEBIT for SELLER + FULL_REFUND', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'SELLER',
        customerRemedy: 'FULL_REFUND',
      }),
    ).toEqual({ kind: 'SELLER_DEBIT' });
  });

  it('returns SELLER_DEBIT for SELLER + PARTIAL_REFUND', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'SELLER',
        customerRemedy: 'PARTIAL_REFUND',
      }),
    ).toEqual({ kind: 'SELLER_DEBIT' });
  });

  it('returns LOGISTICS_CLAIM for LOGISTICS', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'LOGISTICS',
        customerRemedy: 'FULL_REFUND',
      }),
    ).toEqual({ kind: 'LOGISTICS_CLAIM' });
  });

  it('returns PLATFORM_EXPENSE/PLATFORM_FAULT for PLATFORM + non-goodwill', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'PLATFORM',
        customerRemedy: 'FULL_REFUND',
      }),
    ).toEqual({ kind: 'PLATFORM_EXPENSE', expenseType: 'PLATFORM_FAULT' });
  });

  it('returns PLATFORM_EXPENSE/GOODWILL when remedy is GOODWILL_CREDIT — even if liability says SELLER', () => {
    // Note: matrix validator rejects this combo *before* the mapper runs in
    // production, but the mapper should remain honest about the priority of
    // the remedy field. Goodwill is always platform-borne.
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'PLATFORM',
        customerRemedy: 'GOODWILL_CREDIT',
      }),
    ).toEqual({ kind: 'PLATFORM_EXPENSE', expenseType: 'GOODWILL' });
  });

  it('returns null for CUSTOMER (no row to write)', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'CUSTOMER',
        customerRemedy: 'FULL_REFUND',
      }),
    ).toBeNull();
  });

  it('returns null for NONE (no row to write)', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'NONE',
        customerRemedy: 'FULL_REFUND',
      }),
    ).toBeNull();
  });

  it('returns null for REPLACEMENT (no money flow at QC time)', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'SELLER',
        customerRemedy: 'REPLACEMENT',
      }),
    ).toBeNull();
  });

  it('returns null for EXCHANGE (price-diff path is separate)', () => {
    expect(
      mapReturnDecisionToLedger({
        liabilityParty: 'SELLER',
        customerRemedy: 'EXCHANGE',
      }),
    ).toBeNull();
  });
});
