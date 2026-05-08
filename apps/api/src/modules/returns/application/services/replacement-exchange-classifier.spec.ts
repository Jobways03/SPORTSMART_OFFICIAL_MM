import {
  classifyExchangePriceDiff,
  classifyStockAvailability,
  resolveReplacementOrExchange,
} from './replacement-exchange-classifier';

describe('classifyExchangePriceDiff', () => {
  it('EXACT_MATCH when prices equal', () => {
    expect(
      classifyExchangePriceDiff({
        originalPaise: 100_000,
        replacementPaise: 100_000,
      }),
    ).toEqual({ mode: 'EXACT_MATCH', diffInPaise: 0 });
  });

  it('EXACT_MATCH within ₹1 tolerance (avoid noise from rounding)', () => {
    expect(
      classifyExchangePriceDiff({
        originalPaise: 100_000,
        replacementPaise: 100_050,
      }),
    ).toEqual({ mode: 'EXACT_MATCH', diffInPaise: 0 });
  });

  it('COLLECT_FROM_CUSTOMER when replacement is more expensive', () => {
    expect(
      classifyExchangePriceDiff({
        originalPaise: 100_000,
        replacementPaise: 150_000,
      }),
    ).toEqual({ mode: 'COLLECT_FROM_CUSTOMER', diffInPaise: 50_000 });
  });

  it('REFUND_TO_CUSTOMER when replacement is cheaper', () => {
    expect(
      classifyExchangePriceDiff({
        originalPaise: 100_000,
        replacementPaise: 75_000,
      }),
    ).toEqual({ mode: 'REFUND_TO_CUSTOMER', diffInPaise: 25_000 });
  });
});

describe('classifyStockAvailability', () => {
  it('AVAILABLE when stock ≥ requested', () => {
    expect(
      classifyStockAvailability({ availableStock: 5, requestedQuantity: 1 }),
    ).toBe('AVAILABLE');
    expect(
      classifyStockAvailability({ availableStock: 5, requestedQuantity: 5 }),
    ).toBe('AVAILABLE');
  });
  it('UNAVAILABLE when stock < requested', () => {
    expect(
      classifyStockAvailability({ availableStock: 0, requestedQuantity: 1 }),
    ).toBe('UNAVAILABLE');
    expect(
      classifyStockAvailability({ availableStock: 1, requestedQuantity: 3 }),
    ).toBe('UNAVAILABLE');
  });
  it('UNAVAILABLE when requested ≤ 0 (defensive)', () => {
    expect(
      classifyStockAvailability({ availableStock: 99, requestedQuantity: 0 }),
    ).toBe('UNAVAILABLE');
  });
});

describe('resolveReplacementOrExchange', () => {
  it('REPLACEMENT + AVAILABLE → PROCEED with AWAITING_FULFILMENT', () => {
    const r = resolveReplacementOrExchange({
      remedy: 'REPLACEMENT',
      availability: 'AVAILABLE',
    });
    expect(r.kind).toBe('PROCEED');
    expect(r.replacementStatus).toBe('AWAITING_FULFILMENT');
  });

  it('REPLACEMENT + UNAVAILABLE → FALLBACK_TO_REFUND regardless of price', () => {
    const r = resolveReplacementOrExchange({
      remedy: 'REPLACEMENT',
      availability: 'UNAVAILABLE',
    });
    expect(r.kind).toBe('FALLBACK_TO_REFUND');
    expect(r.replacementStatus).toBe('FALLBACK_TO_REFUND');
  });

  it('EXCHANGE + EXACT_MATCH + AVAILABLE → PROCEED', () => {
    const r = resolveReplacementOrExchange({
      remedy: 'EXCHANGE',
      availability: 'AVAILABLE',
      priceDiff: { mode: 'EXACT_MATCH', diffInPaise: 0 },
    });
    expect(r.kind).toBe('PROCEED');
    expect(r.replacementStatus).toBe('AWAITING_FULFILMENT');
  });

  it('EXCHANGE + COLLECT_FROM_CUSTOMER + AVAILABLE → AWAIT_PAYMENT', () => {
    const r = resolveReplacementOrExchange({
      remedy: 'EXCHANGE',
      availability: 'AVAILABLE',
      priceDiff: { mode: 'COLLECT_FROM_CUSTOMER', diffInPaise: 50_000 },
    });
    expect(r.kind).toBe('AWAIT_PAYMENT');
    expect(r.replacementStatus).toBe('AWAITING_PAYMENT');
    expect(r.kind === 'AWAIT_PAYMENT' && r.priceDiff.diffInPaise).toBe(50_000);
  });

  it('EXCHANGE + REFUND_TO_CUSTOMER + AVAILABLE → PROCEED_WITH_PARTIAL_REFUND', () => {
    const r = resolveReplacementOrExchange({
      remedy: 'EXCHANGE',
      availability: 'AVAILABLE',
      priceDiff: { mode: 'REFUND_TO_CUSTOMER', diffInPaise: 25_000 },
    });
    expect(r.kind).toBe('PROCEED_WITH_PARTIAL_REFUND');
    expect(r.replacementStatus).toBe('AWAITING_FULFILMENT');
    expect(
      r.kind === 'PROCEED_WITH_PARTIAL_REFUND' && r.priceDiff.diffInPaise,
    ).toBe(25_000);
  });

  it('EXCHANGE + UNAVAILABLE → FALLBACK_TO_REFUND', () => {
    const r = resolveReplacementOrExchange({
      remedy: 'EXCHANGE',
      availability: 'UNAVAILABLE',
      priceDiff: { mode: 'EXACT_MATCH', diffInPaise: 0 },
    });
    expect(r.kind).toBe('FALLBACK_TO_REFUND');
  });

  it('EXCHANGE without priceDiff throws', () => {
    expect(() =>
      resolveReplacementOrExchange({
        remedy: 'EXCHANGE',
        availability: 'AVAILABLE',
      }),
    ).toThrow(/priceDiff is required when remedy=EXCHANGE/);
  });
});
