import {
  classifyReasonForSellerResponse,
  computeSellerResponseDueAt,
} from './seller-response-classifier';

describe('classifyReasonForSellerResponse', () => {
  describe('pure seller-fault reasons → REQUIRED', () => {
    it.each([
      ['DEFECTIVE'],
      ['WRONG_ITEM'],
      ['NOT_AS_DESCRIBED'],
      ['QUALITY_ISSUE'],
      ['OTHER'],
    ])('%s alone is REQUIRED', (reason) => {
      expect(classifyReasonForSellerResponse([reason])).toBe('REQUIRED');
    });
  });

  describe('non-seller reasons → NOT_REQUIRED', () => {
    it.each([['CHANGED_MIND'], ['SIZE_FIT_ISSUE'], ['DAMAGED_IN_TRANSIT']])(
      '%s alone is NOT_REQUIRED',
      (reason) => {
        expect(classifyReasonForSellerResponse([reason])).toBe('NOT_REQUIRED');
      },
    );
  });

  describe('mixed carts', () => {
    it('mix of SELLER + non-SELLER reasons escalates to REQUIRED', () => {
      expect(
        classifyReasonForSellerResponse(['CHANGED_MIND', 'DEFECTIVE']),
      ).toBe('REQUIRED');
    });

    it('all non-SELLER reasons stays NOT_REQUIRED', () => {
      expect(
        classifyReasonForSellerResponse([
          'CHANGED_MIND',
          'SIZE_FIT_ISSUE',
          'DAMAGED_IN_TRANSIT',
        ]),
      ).toBe('NOT_REQUIRED');
    });

    it('all SELLER reasons stays REQUIRED', () => {
      expect(
        classifyReasonForSellerResponse([
          'DEFECTIVE',
          'WRONG_ITEM',
          'QUALITY_ISSUE',
        ]),
      ).toBe('REQUIRED');
    });
  });

  describe('edge cases', () => {
    it('empty list defaults to NOT_REQUIRED', () => {
      expect(classifyReasonForSellerResponse([])).toBe('NOT_REQUIRED');
    });

    it('unknown reason defaults to REQUIRED (over-notify is safer than miss)', () => {
      expect(classifyReasonForSellerResponse(['SOMETHING_NEW'])).toBe(
        'REQUIRED',
      );
    });

    it('mixed unknown + known-non-seller still escalates to REQUIRED', () => {
      expect(
        classifyReasonForSellerResponse(['UNKNOWN_REASON', 'CHANGED_MIND']),
      ).toBe('REQUIRED');
    });
  });
});

describe('computeSellerResponseDueAt', () => {
  it('defaults to 48 hours from notifiedAt', () => {
    const notified = new Date('2026-05-07T10:00:00Z');
    const due = computeSellerResponseDueAt(notified);
    expect(due.toISOString()).toBe('2026-05-09T10:00:00.000Z');
  });

  it('honours an explicit hours override', () => {
    const notified = new Date('2026-05-07T10:00:00Z');
    expect(computeSellerResponseDueAt(notified, 24).toISOString()).toBe(
      '2026-05-08T10:00:00.000Z',
    );
    expect(computeSellerResponseDueAt(notified, 72).toISOString()).toBe(
      '2026-05-10T10:00:00.000Z',
    );
  });
});
