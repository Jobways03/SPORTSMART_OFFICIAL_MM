// Phase 252 — settlement tax config shape + base resolution.
//
// The three settlement taxes (commission-GST, §52 TCS, §194-O TDS) each have a
// configurable RATE (basis points) and BASE (what the rate is applied to). The
// statutory engine reads this so a CA / regulatory change — e.g. "TDS is on
// commission, not product" — is a config edit that flows to BOTH the seller
// payout AND the GSTR-8 / Form-26Q filings (one source of truth), instead of a
// code change.
//
// The compliance NUANCE stays in code and is NOT a config knob: the GST
// CGST/SGST↔IGST place-of-supply split, and the TDS PAN-based 1%/5% + ₹5L
// threshold. Only the rate and the base amount are configurable.

/** What a settlement tax is levied on. */
export const SETTLEMENT_TAX_BASE_TYPES = [
  'COMMISSION', // the platform's commission / margin on the seller's sales
  'PRICE_OF_GOODS_SOLD', // the gross order value the platform facilitated (net of refunds)
  'GST', // the commission-GST amount (TCS is levied on this — "TCS on GST")
] as const;
export type SettlementTaxBaseType = (typeof SETTLEMENT_TAX_BASE_TYPES)[number];

export function isSettlementTaxBaseType(v: unknown): v is SettlementTaxBaseType {
  return (
    typeof v === 'string' &&
    (SETTLEMENT_TAX_BASE_TYPES as readonly string[]).includes(v)
  );
}

export interface OneTaxConfig {
  rateBps: number;
  baseType: SettlementTaxBaseType;
}

export interface SettlementTaxConfig {
  gst: OneTaxConfig;
  tcs: OneTaxConfig;
  tds: OneTaxConfig;
}

// Defaults: GST 18% on commission; TCS 1% on the commission-GST amount ("TCS on
// GST", per the team); TDS 1% on commission (per the CA). These are read by the
// statutory engine and editable in the admin "Settlement Charges" page.
export const DEFAULT_SETTLEMENT_TAX_CONFIG: SettlementTaxConfig = {
  gst: { rateBps: 1800, baseType: 'COMMISSION' },
  tcs: { rateBps: 100, baseType: 'GST' },
  tds: { rateBps: 100, baseType: 'COMMISSION' },
};

/**
 * Resolve the base AMOUNT (paise) a tax is levied on, from a settlement's
 * candidate bases. Used by both the per-settlement slice and the period
 * aggregate so they reconcile by construction.
 */
export function resolveTaxBaseInPaise(
  baseType: SettlementTaxBaseType,
  bases: {
    commissionInPaise: bigint;
    priceOfGoodsSoldInPaise: bigint;
    gstInPaise: bigint;
  },
): bigint {
  switch (baseType) {
    case 'COMMISSION':
      return bases.commissionInPaise;
    case 'PRICE_OF_GOODS_SOLD':
      return bases.priceOfGoodsSoldInPaise;
    case 'GST':
      return bases.gstInPaise;
    default:
      return bases.commissionInPaise;
  }
}
