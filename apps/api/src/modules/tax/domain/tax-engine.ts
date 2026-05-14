// Phase 3 of the GST/tax/invoice system — Tax Engine v2.
//
// Pure function: takes a line's gross amount + discount + rate +
// taxability + pricing mode + POS, returns the full per-line breakdown
// (taxable + CGST/SGST/IGST + total tax + line total).
//
// Why a new engine alongside the legacy `discounts/domain/tax/
// calculate-gst.ts`?
//   - The legacy engine assumes exclusive pricing always, taxable
//     supply always. It works for today's zero-rate test data but
//     can't represent NIL_RATED / EXEMPT / NON_GST / ZERO_RATED
//     (each must show on GSTR-1 in a different section).
//   - The legacy engine takes no `priceIncludesTax` flag — the
//     Indian B2C convention is GST-inclusive prices, which need a
//     back-out split rather than an add-on.
//   - The legacy engine is wired into the discount-allocation tx;
//     a clean swap means Phase 4 (discount tax treatment) and
//     Phase 5 (snapshot extension) can adopt the new engine
//     without churning the discount module.
//
// Phase 4 wires `discount-allocation.service.ts` to use this new
// engine. Until then, the legacy engine remains active.
//
// See:
//   - ADR-004 (Money VO, paise canonical)
//   - docs/tax/CA.md §A Phase 3 log
//   - docs/tax/GST_ASSUMPTIONS.md §2 (engine + tax rule decisions)

import type { SupplyTaxability } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────

export type TaxabilityName =
  | 'TAXABLE'
  | 'NIL_RATED'
  | 'EXEMPT'
  | 'NON_GST'
  | 'ZERO_RATED'
  | 'OUT_OF_SCOPE';

export type TaxSplitTypeName = 'CGST_SGST' | 'IGST';

export type PricingMode = 'INCLUSIVE' | 'EXCLUSIVE';

export interface TaxEngineInput {
  /** Gross line amount in paise. If `priceIncludesTax=true`, this is
   *  inclusive of GST; if false, exclusive. */
  grossInPaise: bigint;
  /** Discount allocated to this line (always treated as a pre-supply
   *  transactional discount that reduces taxable value). Indian GST
   *  Section 15(3)(a). Must be ≤ grossInPaise. */
  discountInPaise: bigint;
  /** GST rate in basis points (1800 = 18%). Ignored if taxability is
   *  not TAXABLE; must be 0 for NIL_RATED/EXEMPT/NON_GST. */
  gstRateBps: number;
  /** Cess rate in basis points; defaults to 0. Reserved for future
   *  HSN that attract compensation cess (motor vehicles, tobacco etc).
   *  Sports goods generally don't have cess today. */
  cessRateBps?: number;
  /** Inclusive pricing? B2C catalog default = true. */
  priceIncludesTax: boolean;
  /** Intra-state (CGST+SGST) or inter-state (IGST). */
  isIntraState: boolean;
  /** Taxability classification — controls which GST rows appear and
   *  in which GSTR-1 section the supply lands. */
  supplyTaxability: TaxabilityName;
}

export interface TaxEngineResult {
  // Inputs echoed for snapshot persistence
  grossInPaise: bigint;
  discountInPaise: bigint;
  taxableInPaise: bigint;
  gstRateBps: number;
  cessRateBps: number;
  supplyTaxability: TaxabilityName;
  pricingMode: PricingMode;
  taxSplitType: TaxSplitTypeName;

  // Outputs
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
  totalTaxInPaise: bigint;
  /** Final customer-facing line total = taxable + totalTax. For
   *  inclusive pricing this equals gross − discount; for exclusive
   *  pricing this equals (gross − discount) + tax. */
  lineTotalInPaise: bigint;
  /** Reportable "outward supply" base for GSTR-1 / 3B. Equals taxable
   *  for TAXABLE/ZERO_RATED; equals gross−discount for NIL_RATED/
   *  EXEMPT/NON_GST (no tax, but still reported separately). */
  reportableValueInPaise: bigint;
}

export class TaxEngineError extends Error {
  constructor(message: string, public readonly input: TaxEngineInput) {
    super(message);
    this.name = 'TaxEngineError';
  }
}

// ─── Public function ────────────────────────────────────────────

/**
 * Compute GST for a single tax-line. Pure.
 *
 * Algorithm:
 *   1. Validate inputs.
 *   2. Apply taxability short-circuits (NIL/EXEMPT/NON_GST/OUT_OF_SCOPE
 *      ⇒ zero tax).
 *   3. Compute taxable base depending on pricing mode:
 *        EXCLUSIVE: taxable = (gross − discount)
 *        INCLUSIVE: netInclusive = (gross − discount);
 *                   taxable = floor(netInclusive × 10000 / (10000 + rate))
 *                   tax     = netInclusive − taxable
 *   4. Split tax into CGST+SGST (intra) or IGST (inter). Use
 *      conservation derivation for SGST to guarantee sum equals total.
 *   5. Compute compensation cess (always exclusive, post-tax).
 *   6. Return composed result.
 *
 * Invariants:
 *   - taxableInPaise >= 0
 *   - cgst + sgst + igst === totalTax (always)
 *   - exclusive: lineTotal = taxable + totalTax + cess
 *   - inclusive: lineTotal = grossInPaise - discountInPaise + cess
 *                (cess is exclusive even when GST is inclusive)
 */
export function calculateLineTax(input: TaxEngineInput): TaxEngineResult {
  validate(input);

  const pricingMode: PricingMode = input.priceIncludesTax ? 'INCLUSIVE' : 'EXCLUSIVE';
  const taxSplitType: TaxSplitTypeName = input.isIntraState ? 'CGST_SGST' : 'IGST';
  const cessRateBps = input.cessRateBps ?? 0;

  // Non-taxable supplies short-circuit. Note these rows still appear
  // on GSTR-1 — separately in NIL_RATED / EXEMPT / NON_GST sections.
  if (
    input.supplyTaxability === 'NIL_RATED' ||
    input.supplyTaxability === 'EXEMPT' ||
    input.supplyTaxability === 'NON_GST' ||
    input.supplyTaxability === 'OUT_OF_SCOPE'
  ) {
    const taxable = input.grossInPaise - input.discountInPaise;
    return {
      grossInPaise: input.grossInPaise,
      discountInPaise: input.discountInPaise,
      taxableInPaise: taxable,
      gstRateBps: 0,
      cessRateBps: 0,
      supplyTaxability: input.supplyTaxability,
      pricingMode,
      taxSplitType,
      cgstInPaise: 0n,
      sgstInPaise: 0n,
      igstInPaise: 0n,
      cessInPaise: 0n,
      totalTaxInPaise: 0n,
      lineTotalInPaise: taxable,
      reportableValueInPaise: taxable,
    };
  }

  // ZERO_RATED: rate is 0 for the customer (e.g. exports under LUT)
  // BUT reported as zero-rated outward supply on GSTR-1 (different
  // from EXEMPT). Customer pays the gross minus discount; no tax.
  // Treated like TAXABLE with rate=0 for the math, but flagged for
  // reporting via supplyTaxability + reportableValueInPaise.
  // For now Sportsmart is India-only so ZERO_RATED is unused; the
  // branch exists for schema completeness.

  const rateBps = BigInt(input.gstRateBps);
  const cessBps = BigInt(cessRateBps);

  let taxableInPaise: bigint;
  let totalTaxInPaise: bigint;

  if (input.priceIncludesTax) {
    // Inclusive pricing. netInclusive is what we have *before*
    // splitting. taxable + GST = netInclusive (per item line).
    // cess is exclusive even in inclusive mode (cess is layered on
    // top of GST in CBIC rule).
    const netInclusive = input.grossInPaise - input.discountInPaise;
    // taxable = netInclusive × 10000 / (10000 + rateBps)
    taxableInPaise = (netInclusive * 10_000n) / (10_000n + rateBps);
    totalTaxInPaise = netInclusive - taxableInPaise;
  } else {
    // Exclusive pricing. taxable = gross − discount; tax adds on top.
    taxableInPaise = input.grossInPaise - input.discountInPaise;
    totalTaxInPaise = (taxableInPaise * rateBps) / 10_000n;
  }

  // Split into CGST/SGST or IGST. Conservation: cgst + sgst + igst === totalTax.
  let cgstInPaise = 0n;
  let sgstInPaise = 0n;
  let igstInPaise = 0n;

  if (input.isIntraState) {
    const halfBps = rateBps / 2n;
    // Compute CGST from base, derive SGST from total (to guarantee sum exact).
    // For inclusive mode, derive CGST = floor(totalTax / 2) by inverse of total.
    // We use the same approach: compute CGST as half rate × taxable / 10000,
    // then SGST = totalTax − CGST.
    cgstInPaise = (taxableInPaise * halfBps) / 10_000n;
    sgstInPaise = totalTaxInPaise - cgstInPaise;
  } else {
    igstInPaise = totalTaxInPaise;
  }

  // Compensation cess — always exclusive, applied on taxable base.
  // (Per Cess Rules, cess is on the "value of supply" — same base
  // as GST.)
  const cessInPaise = cessBps > 0n ? (taxableInPaise * cessBps) / 10_000n : 0n;

  // Final line total.
  // Exclusive: taxable + totalTax + cess
  // Inclusive: gross − discount + cess (cess is exclusive even when
  //            GST is inclusive, per CBIC clarification)
  const lineTotalInPaise = input.priceIncludesTax
    ? (input.grossInPaise - input.discountInPaise) + cessInPaise
    : taxableInPaise + totalTaxInPaise + cessInPaise;

  return {
    grossInPaise: input.grossInPaise,
    discountInPaise: input.discountInPaise,
    taxableInPaise,
    gstRateBps: input.gstRateBps,
    cessRateBps,
    supplyTaxability: input.supplyTaxability,
    pricingMode,
    taxSplitType,
    cgstInPaise,
    sgstInPaise,
    igstInPaise,
    cessInPaise,
    totalTaxInPaise,
    lineTotalInPaise,
    reportableValueInPaise: taxableInPaise,
  };
}

// ─── Validation ─────────────────────────────────────────────────

function validate(input: TaxEngineInput): void {
  if (typeof input.grossInPaise !== 'bigint') {
    throw new TaxEngineError('grossInPaise must be a BigInt', input);
  }
  if (typeof input.discountInPaise !== 'bigint') {
    throw new TaxEngineError('discountInPaise must be a BigInt', input);
  }
  if (input.grossInPaise < 0n) {
    throw new TaxEngineError('grossInPaise cannot be negative', input);
  }
  if (input.discountInPaise < 0n) {
    throw new TaxEngineError('discountInPaise cannot be negative', input);
  }
  if (input.discountInPaise > input.grossInPaise) {
    throw new TaxEngineError(
      `discountInPaise (${input.discountInPaise}) cannot exceed grossInPaise (${input.grossInPaise})`,
      input,
    );
  }
  if (!Number.isInteger(input.gstRateBps) || input.gstRateBps < 0) {
    throw new TaxEngineError('gstRateBps must be a non-negative integer', input);
  }
  if (input.cessRateBps !== undefined) {
    if (!Number.isInteger(input.cessRateBps) || input.cessRateBps < 0) {
      throw new TaxEngineError('cessRateBps must be a non-negative integer', input);
    }
  }
  if (input.priceIncludesTax !== true && input.priceIncludesTax !== false) {
    throw new TaxEngineError('priceIncludesTax must be a boolean', input);
  }
  if (input.isIntraState !== true && input.isIntraState !== false) {
    throw new TaxEngineError('isIntraState must be a boolean', input);
  }
  const VALID_TAXABILITY: ReadonlyArray<TaxabilityName> = [
    'TAXABLE',
    'NIL_RATED',
    'EXEMPT',
    'NON_GST',
    'ZERO_RATED',
    'OUT_OF_SCOPE',
  ];
  if (!VALID_TAXABILITY.includes(input.supplyTaxability)) {
    throw new TaxEngineError(
      `supplyTaxability must be one of ${VALID_TAXABILITY.join(', ')}; got "${input.supplyTaxability}"`,
      input,
    );
  }
  // Sanity: NIL/EXEMPT/NON_GST/OUT_OF_SCOPE should have rate 0.
  if (
    input.supplyTaxability !== 'TAXABLE' &&
    input.supplyTaxability !== 'ZERO_RATED' &&
    input.gstRateBps > 0
  ) {
    throw new TaxEngineError(
      `${input.supplyTaxability} supplies cannot have gstRateBps > 0 (got ${input.gstRateBps})`,
      input,
    );
  }
}

// ─── Bridging — accept Prisma's SupplyTaxability enum ───────────

/**
 * Convenience wrapper that accepts the Prisma-generated enum value
 * (which is a string at runtime) and forwards to calculateLineTax.
 */
export function calculateLineTaxFromPrismaEnum(
  input: Omit<TaxEngineInput, 'supplyTaxability'> & { supplyTaxability: SupplyTaxability },
): TaxEngineResult {
  return calculateLineTax({
    ...input,
    supplyTaxability: input.supplyTaxability as unknown as TaxabilityName,
  });
}
