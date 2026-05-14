// Phase 2 of the GST/tax/invoice system — Place-of-Supply resolver
// (pure function). The DB-aware service that loads inputs lives at
// application/services/place-of-supply.service.ts.
//
// Rule (per Section 12 of IGST Act, simplified for goods marketplace):
//   - supplier state == place-of-supply state → intra-state → CGST+SGST
//   - supplier state != place-of-supply state → inter-state → IGST
//
// "Place of supply" determination for goods (typical marketplace case):
//   - B2C delivery        : place-of-supply = customer shipping state
//   - B2B with GSTIN      : configurable — defaults to shipping state.
//                           CA may flip to BUYER_GSTIN_STATE via
//                           tax_config.b2b_place_of_supply_source.
//   - Pickup at store     : place-of-supply = store/dispatch state (NOT
//                           used yet — no in-person pickup flow today)
//
// See docs/tax/CA.md §3.1 (B2B POS decision) and
// docs/tax/GST_ASSUMPTIONS.md §3.

export type TaxSplitTypeName = 'CGST_SGST' | 'IGST';

export type B2bPosSource = 'SHIPPING' | 'BUYER_GSTIN_STATE';

export interface PlaceOfSupplyInput {
  /** 2-digit GST state code of the supplier (seller / franchise / platform). */
  supplierStateCode: string;
  /** 2-digit GST state code derived from customer shipping address. */
  customerShippingStateCode: string;
  /** 2-digit GST state code from customer billing address (optional). */
  customerBillingStateCode?: string;
  /** 2-digit prefix of customer GSTIN if B2B. */
  customerGstinStateCode?: string;
  /** Optional invoice classification. B2C is default. */
  invoiceType?: 'B2C' | 'B2B';
  /** B2B POS source — set from tax_config.b2b_place_of_supply_source. */
  posSourceForB2b?: B2bPosSource;
}

export interface PlaceOfSupplyResult {
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  isIntraState: boolean;
  taxSplitType: TaxSplitTypeName;
  resolutionReason: string;
}

/** Thrown when inputs cannot satisfy POS resolution rules. */
export class PlaceOfSupplyResolutionError extends Error {
  constructor(message: string, public readonly input: PlaceOfSupplyInput) {
    super(message);
    this.name = 'PlaceOfSupplyResolutionError';
  }
}

/**
 * Resolve place-of-supply for a single sub-order / invoice context.
 * Pure function — no DB access. The caller is responsible for loading
 * supplier state code + customer state code and passing them in.
 */
export function resolvePlaceOfSupply(input: PlaceOfSupplyInput): PlaceOfSupplyResult {
  assertStateCode(input.supplierStateCode, 'supplierStateCode', input);

  // Choose place-of-supply state per type + config
  let placeOfSupplyStateCode: string;
  let resolutionReason: string;

  if (
    input.invoiceType === 'B2B' &&
    input.posSourceForB2b === 'BUYER_GSTIN_STATE' &&
    input.customerGstinStateCode
  ) {
    placeOfSupplyStateCode = input.customerGstinStateCode;
    resolutionReason = 'B2B with buyer GSTIN — POS = buyer GSTIN state (tax_config.b2b_place_of_supply_source=BUYER_GSTIN_STATE)';
  } else {
    placeOfSupplyStateCode = input.customerShippingStateCode;
    resolutionReason = input.invoiceType === 'B2B'
      ? 'B2B with shipping-state POS rule (tax_config.b2b_place_of_supply_source=SHIPPING)'
      : 'B2C — POS = shipping state';
  }

  assertStateCode(placeOfSupplyStateCode, 'placeOfSupplyStateCode', input);

  const isIntraState = input.supplierStateCode === placeOfSupplyStateCode;
  const taxSplitType: TaxSplitTypeName = isIntraState ? 'CGST_SGST' : 'IGST';

  return {
    supplierStateCode: input.supplierStateCode,
    placeOfSupplyStateCode,
    isIntraState,
    taxSplitType,
    resolutionReason,
  };
}

function assertStateCode(code: string, fieldName: string, input: PlaceOfSupplyInput): void {
  if (!code || typeof code !== 'string') {
    throw new PlaceOfSupplyResolutionError(
      `${fieldName} is required`,
      input,
    );
  }
  if (!/^[0-9]{2}$/.test(code)) {
    throw new PlaceOfSupplyResolutionError(
      `${fieldName} must be a 2-digit GST state code (got "${code}")`,
      input,
    );
  }
}
