/**
 * Phase 13 (P1.14) — pure helpers for the replacement / exchange flow.
 *
 * Two questions to answer at QC time:
 *
 *   1. PriceDiffMode — for an EXCHANGE (different SKU), how does the
 *      money move? Three possibilities:
 *        - EXACT_MATCH: prices equal (within ₹1 rounding tolerance) →
 *          no money movement, ship the new SKU at ₹0.
 *        - COLLECT_FROM_CUSTOMER: new SKU costs more → customer pays
 *          the diff before fulfilment (lifecycle = AWAITING_PAYMENT).
 *        - REFUND_TO_CUSTOMER: new SKU costs less → partial
 *          RefundInstruction for the diff; ship the new SKU once paid.
 *
 *   2. AvailabilityMode — given inventory at QC time, can we fulfil?
 *        - AVAILABLE: variant has stock; proceed.
 *        - UNAVAILABLE: variant has no stock → fall back to a full
 *          refund (per spec: "stock unavailable should offer refund
 *          instead"). Caller flips replacementStatus to
 *          FALLBACK_TO_REFUND and routes through the existing refund
 *          path.
 *
 * Both functions are pure — no DB calls, no clock reads. Callers
 * fetch the inputs (variant price, available stock) and pass them in.
 */

export type PriceDiffMode =
  | 'EXACT_MATCH'
  | 'COLLECT_FROM_CUSTOMER'
  | 'REFUND_TO_CUSTOMER';

export type AvailabilityMode = 'AVAILABLE' | 'UNAVAILABLE';

/** Tolerance below which two prices are treated as identical (₹1). */
export const PRICE_MATCH_TOLERANCE_PAISE = 100;

export interface PriceDiffResolution {
  mode: PriceDiffMode;
  /**
   * Absolute paise difference. Positive number; sign is implied by mode.
   * Caller uses this directly:
   *   COLLECT_FROM_CUSTOMER → present a checkout flow for `diffInPaise`
   *   REFUND_TO_CUSTOMER → mint a partial RefundInstruction for `diffInPaise`
   *   EXACT_MATCH → diffInPaise is 0
   */
  diffInPaise: number;
}

export function classifyExchangePriceDiff(args: {
  /** What the customer originally paid for the returning items. */
  originalPaise: number;
  /** What the new SKU is priced at right now. */
  replacementPaise: number;
}): PriceDiffResolution {
  const diff = args.replacementPaise - args.originalPaise;
  const abs = Math.abs(diff);
  if (abs <= PRICE_MATCH_TOLERANCE_PAISE) {
    return { mode: 'EXACT_MATCH', diffInPaise: 0 };
  }
  if (diff > 0) {
    return { mode: 'COLLECT_FROM_CUSTOMER', diffInPaise: abs };
  }
  return { mode: 'REFUND_TO_CUSTOMER', diffInPaise: abs };
}

export function classifyStockAvailability(args: {
  availableStock: number;
  requestedQuantity: number;
}): AvailabilityMode {
  if (args.requestedQuantity <= 0) return 'UNAVAILABLE';
  return args.availableStock >= args.requestedQuantity
    ? 'AVAILABLE'
    : 'UNAVAILABLE';
}

/**
 * The full QC-time decision: what state should the return enter
 * after the admin chooses REPLACEMENT or EXCHANGE? The result
 * tells the service which lifecycle status to write.
 *
 * Note: REPLACEMENT (same SKU) skips price-diff entirely — same
 * SKU at the same price by definition.
 */
export type ReplacementResolution =
  | { kind: 'PROCEED'; replacementStatus: 'AWAITING_FULFILMENT'; priceDiff?: undefined }
  | {
      kind: 'AWAIT_PAYMENT';
      replacementStatus: 'AWAITING_PAYMENT';
      priceDiff: PriceDiffResolution;
    }
  | {
      kind: 'PROCEED_WITH_PARTIAL_REFUND';
      replacementStatus: 'AWAITING_FULFILMENT';
      priceDiff: PriceDiffResolution;
    }
  | { kind: 'FALLBACK_TO_REFUND'; replacementStatus: 'FALLBACK_TO_REFUND'; priceDiff?: undefined };

export function resolveReplacementOrExchange(args: {
  remedy: 'REPLACEMENT' | 'EXCHANGE';
  availability: AvailabilityMode;
  /** Required for EXCHANGE; ignored for REPLACEMENT. */
  priceDiff?: PriceDiffResolution;
}): ReplacementResolution {
  if (args.availability === 'UNAVAILABLE') {
    return {
      kind: 'FALLBACK_TO_REFUND',
      replacementStatus: 'FALLBACK_TO_REFUND',
    };
  }
  if (args.remedy === 'REPLACEMENT') {
    return { kind: 'PROCEED', replacementStatus: 'AWAITING_FULFILMENT' };
  }
  // EXCHANGE — must have a priceDiff result.
  if (!args.priceDiff) {
    throw new Error(
      'priceDiff is required when remedy=EXCHANGE; classify with classifyExchangePriceDiff first.',
    );
  }
  if (args.priceDiff.mode === 'EXACT_MATCH') {
    return { kind: 'PROCEED', replacementStatus: 'AWAITING_FULFILMENT' };
  }
  if (args.priceDiff.mode === 'COLLECT_FROM_CUSTOMER') {
    return {
      kind: 'AWAIT_PAYMENT',
      replacementStatus: 'AWAITING_PAYMENT',
      priceDiff: args.priceDiff,
    };
  }
  // REFUND_TO_CUSTOMER
  return {
    kind: 'PROCEED_WITH_PARTIAL_REFUND',
    replacementStatus: 'AWAITING_FULFILMENT',
    priceDiff: args.priceDiff,
  };
}
