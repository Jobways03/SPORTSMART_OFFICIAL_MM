// Phase 28 — Marketplace commission GST (output tax on platform fee).
//
// The marketplace's commission to a seller is a SUPPLY OF SERVICES
// from the marketplace to the seller. Under GST, this attracts 18%
// output tax — Section 9 of the CGST Act, classified under SAC
// 9985 (Support services).
//
// Place of supply rule (services, B2B with registered recipient):
//   IGST Act Section 12(2)(a) — place of supply = location of the
//   recipient (the seller's registered place of business).
//
// Therefore:
//   - Marketplace state == seller state → intra-state → CGST + SGST
//   - Marketplace state != seller state → inter-state → IGST
//
// This is INDEPENDENT of the product GST flow (which goes seller →
// customer). Two separate GST trails:
//
//   Product GST:    customer ← invoice ← seller    (seller's output)
//   Commission GST: marketplace → invoice → seller (marketplace's
//                                                   output, seller's
//                                                   input ITC)
//
// The amount aggregates per (marketplace, seller, period) and goes
// into the MARKETPLACE's own GSTR-1 as outward supply, and the
// SELLER's GSTR-2B as inward supply (claimable as ITC).
//
// Pure function — half-away-from-zero rounding, parity with the
// rest of the money codebase.

export const DEFAULT_COMMISSION_GST_RATE_BPS = 1800; // 18%

export type CommissionGstSplitType = 'CGST_SGST' | 'IGST';

export interface CommissionGstInput {
  commissionAmountInPaise: bigint;
  /** 2-digit GST state code of the marketplace (PlatformGstProfile). */
  marketplaceStateCode: string;
  /** 2-digit GST state code of the seller (Seller.gstStateCode). */
  sellerStateCode: string;
  /** Override the default 18% if regulatory change shifts the rate. */
  rateBpsOverride?: number;
}

export interface CommissionGstBreakdown {
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  totalGstInPaise: bigint;
  rateBps: number;
  splitType: CommissionGstSplitType;
  /** True when state codes were available and the split was made on
   *  real data. False when either side was missing/blank — caller
   *  falls back to "presume inter-state IGST" via the input pre-check
   *  before calling this function. */
  isIntraState: boolean;
}

/**
 * Compute the commission GST split for one seller in one period.
 *
 * Returns zero when commission is zero or negative (negative is the
 * net-after-reversals case; the caller writes zero, not a refund —
 * commission reversals show up in the next period's aggregation).
 */
export function computeCommissionGst(
  input: CommissionGstInput,
): CommissionGstBreakdown {
  const rateBps = input.rateBpsOverride ?? DEFAULT_COMMISSION_GST_RATE_BPS;
  if (rateBps < 0 || rateBps > 10_000) {
    throw new Error(`Commission GST rate out of range: ${rateBps} bps`);
  }

  if (input.commissionAmountInPaise <= 0n) {
    return zeroBreakdown(rateBps, input);
  }

  const isIntraState =
    !!input.marketplaceStateCode &&
    !!input.sellerStateCode &&
    input.marketplaceStateCode === input.sellerStateCode;

  const totalGstInPaise = mulBpsRoundHalfAway(
    input.commissionAmountInPaise,
    rateBps,
  );

  if (isIntraState) {
    // CGST = SGST = totalGst / 2. Derive SGST from total so the two
    // legs sum exactly to totalGst regardless of odd-paise rounding.
    const cgst = totalGstInPaise / 2n;
    const sgst = totalGstInPaise - cgst;
    return {
      cgstInPaise: cgst,
      sgstInPaise: sgst,
      igstInPaise: 0n,
      totalGstInPaise,
      rateBps,
      splitType: 'CGST_SGST',
      isIntraState: true,
    };
  }

  // Inter-state OR state info missing → conservative IGST.
  return {
    cgstInPaise: 0n,
    sgstInPaise: 0n,
    igstInPaise: totalGstInPaise,
    totalGstInPaise,
    rateBps,
    splitType: 'IGST',
    isIntraState: false,
  };
}

// ───────────────────────────────────────────────────────────────

function zeroBreakdown(
  rateBps: number,
  input: CommissionGstInput,
): CommissionGstBreakdown {
  const isIntraState =
    !!input.marketplaceStateCode &&
    !!input.sellerStateCode &&
    input.marketplaceStateCode === input.sellerStateCode;
  return {
    cgstInPaise: 0n,
    sgstInPaise: 0n,
    igstInPaise: 0n,
    totalGstInPaise: 0n,
    rateBps,
    splitType: isIntraState ? 'CGST_SGST' : 'IGST',
    isIntraState,
  };
}

function mulBpsRoundHalfAway(value: bigint, bps: number): bigint {
  if (bps === 0 || value === 0n) return 0n;
  const num = value * BigInt(bps);
  const denom = 10_000n;
  const quotient = num / denom;
  const remainder = num % denom;
  const absRem = remainder < 0n ? -remainder : remainder;
  if (absRem * 2n >= denom) {
    return num >= 0n ? quotient + 1n : quotient - 1n;
  }
  return quotient;
}
