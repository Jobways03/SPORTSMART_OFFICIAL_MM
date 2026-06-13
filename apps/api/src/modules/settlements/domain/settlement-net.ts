// Single source of truth for the settlement NET payable (paise).
//
// net = gross − the statutory deductions (commission-GST + §52 TCS + §194-O
// TDS). Clamped at 0 — you never wire a negative payout.
//
// Phase 252 — these three taxes are now config-driven (rate + base via
// tax_config) and feed BOTH the payout and the GSTR-8 / Form-26Q / GSTR-1
// filings, so there is exactly ONE deduction story. (The earlier generic
// "dynamic charge rules" total has been retired — see settlement-tax-config.ts.)
//
// EVERY net computation — the payout (markSettlementPaid), the audit log, the
// earnings KPI, AND the `netPayableInPaise` field on read endpoints — routes
// through here, so the formula lives in ONE place.

export interface SettlementNetInput {
  /** Gross owed before deductions (seller: settlement amount; franchise: net payable). */
  grossInPaise: bigint;
  tcsDeductedInPaise: bigint;
  tdsDeductedInPaise: bigint;
  totalCommissionGstInPaise: bigint;
}

export function settlementNetPayableInPaise(input: SettlementNetInput): bigint {
  const deductions =
    input.tcsDeductedInPaise +
    input.tdsDeductedInPaise +
    input.totalCommissionGstInPaise;
  const net = input.grossInPaise - deductions;
  return net > 0n ? net : 0n;
}

/** paise/bigint/number/string/Decimal → bigint paise (0 when null). */
function toPaise(v: unknown): bigint {
  if (v === null || v === undefined) return 0n;
  // BigInt paise columns serialise as integer strings; Decimal/number won't
  // reach here (callers pass gross separately), but guard the fractional case.
  const s = (v as { toString(): string }).toString();
  return BigInt(s.includes('.') ? s.slice(0, s.indexOf('.')) : s);
}

/**
 * Compute the net from a settlement row + its gross (paise). The row only needs
 * the deduction scalar columns — works for both SellerSettlement and
 * FranchiseSettlement (same column names).
 */
export function settlementNetFromRow(
  row: {
    tcsDeductedInPaise?: bigint | number | string | null;
    tdsDeductedInPaise?: bigint | number | string | null;
    totalCommissionGstInPaise?: bigint | number | string | null;
  },
  grossInPaise: bigint,
): bigint {
  return settlementNetPayableInPaise({
    grossInPaise,
    tcsDeductedInPaise: toPaise(row.tcsDeductedInPaise),
    tdsDeductedInPaise: toPaise(row.tdsDeductedInPaise),
    totalCommissionGstInPaise: toPaise(row.totalCommissionGstInPaise),
  });
}
