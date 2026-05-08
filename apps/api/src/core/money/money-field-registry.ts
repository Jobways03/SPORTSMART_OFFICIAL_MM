/**
 * Phase 1.4 — registry of Decimal money columns and their paise siblings.
 *
 * Used by MoneyDualWriteExtension to copy every write to the Decimal
 * column into the corresponding `*_in_paise` column when
 * MONEY_DUAL_WRITE_ENABLED is true.
 *
 * Adding a new dual-written column means:
 *   1. Add the column + Prisma BigInt field to the schema
 *   2. Add the migration (ALTER TABLE + UPDATE)
 *   3. Append { decimal, paise } to the appropriate model's tuple
 *
 * Keep the model keys EXACTLY as Prisma exposes them on the client
 * (camelCased model name, e.g. `commissionRecord` not `CommissionRecord`).
 * The extension matches on `args.model` which Prisma passes camelCased.
 */
export interface MoneyFieldPair {
  /** Decimal field name as exposed in Prisma client args (camelCase). */
  decimal: string;
  /** Paise field name as exposed in Prisma client args (camelCase). */
  paise: string;
}

export const MONEY_FIELD_REGISTRY: Readonly<
  Record<string, readonly MoneyFieldPair[]>
> = {
  // ── returns / refunds ──────────────────────────────────────────
  return: [{ decimal: 'refundAmount', paise: 'refundAmountInPaise' }],
  returnItem: [{ decimal: 'refundAmount', paise: 'refundAmountInPaise' }],
  refundTransaction: [{ decimal: 'amount', paise: 'amountInPaise' }],

  // ── orders ─────────────────────────────────────────────────────
  masterOrder: [
    { decimal: 'totalAmount', paise: 'totalAmountInPaise' },
    { decimal: 'discountAmount', paise: 'discountAmountInPaise' },
  ],
  subOrder: [{ decimal: 'subTotal', paise: 'subTotalInPaise' }],
  orderItem: [
    { decimal: 'unitPrice', paise: 'unitPriceInPaise' },
    { decimal: 'totalPrice', paise: 'totalPriceInPaise' },
  ],

  // ── settlements ────────────────────────────────────────────────
  settlementCycle: [
    { decimal: 'totalAmount', paise: 'totalAmountInPaise' },
    { decimal: 'totalMargin', paise: 'totalMarginInPaise' },
  ],
  sellerSettlement: [
    { decimal: 'totalPlatformAmount', paise: 'totalPlatformAmountInPaise' },
    {
      decimal: 'totalSettlementAmount',
      paise: 'totalSettlementAmountInPaise',
    },
    { decimal: 'totalPlatformMargin', paise: 'totalPlatformMarginInPaise' },
  ],
  settlementAdjustment: [{ decimal: 'amount', paise: 'amountInPaise' }],

  // ── commission ─────────────────────────────────────────────────
  commissionSetting: [
    { decimal: 'commissionValue', paise: 'commissionValueInPaise' },
    {
      decimal: 'secondCommissionValue',
      paise: 'secondCommissionValueInPaise',
    },
    {
      decimal: 'maxCommissionAmount',
      paise: 'maxCommissionAmountInPaise',
    },
  ],
  commissionRecord: [
    { decimal: 'platformPrice', paise: 'platformPriceInPaise' },
    { decimal: 'settlementPrice', paise: 'settlementPriceInPaise' },
    { decimal: 'totalPlatformAmount', paise: 'totalPlatformAmountInPaise' },
    {
      decimal: 'totalSettlementAmount',
      paise: 'totalSettlementAmountInPaise',
    },
    { decimal: 'platformMargin', paise: 'platformMarginInPaise' },
    { decimal: 'unitPrice', paise: 'unitPriceInPaise' },
    { decimal: 'totalPrice', paise: 'totalPriceInPaise' },
    { decimal: 'unitCommission', paise: 'unitCommissionInPaise' },
    { decimal: 'totalCommission', paise: 'totalCommissionInPaise' },
    { decimal: 'adminEarning', paise: 'adminEarningInPaise' },
    { decimal: 'productEarning', paise: 'productEarningInPaise' },
    {
      decimal: 'refundedAdminEarning',
      paise: 'refundedAdminEarningInPaise',
    },
    { decimal: 'vatOnCommission', paise: 'vatOnCommissionInPaise' },
    { decimal: 'taxCommission', paise: 'taxCommissionInPaise' },
    { decimal: 'shippingCommission', paise: 'shippingCommissionInPaise' },
    {
      decimal: 'originalAdminEarning',
      paise: 'originalAdminEarningInPaise',
    },
  ],
  commissionReversalRecord: [
    { decimal: 'totalRefundAmount', paise: 'totalRefundAmountInPaise' },
    {
      decimal: 'refundedAdminEarning',
      paise: 'refundedAdminEarningInPaise',
    },
  ],

  // ── COD ────────────────────────────────────────────────────────
  codDecisionLog: [
    { decimal: 'orderTotalInr', paise: 'orderTotalInPaise' },
  ],
  payout: [{ decimal: 'amount', paise: 'amountInPaise' }],
};

/**
 * Convert a Decimal-or-number value to integer paise.
 *
 * Accepts:
 *   - Prisma.Decimal (from DB reads)
 *   - number (from app code that reads .toNumber() first or uses raw)
 *   - string (Prisma serializes Decimal as string in some paths)
 *   - undefined / null → returns null (caller decides)
 *
 * Uses Math.round half-away-from-zero (matches Money VO's roundHalfUp).
 */
export function toPaise(
  value: unknown,
): bigint | null {
  if (value === null || value === undefined) return null;
  // Prisma.Decimal exposes a .toNumber() method. We accept anything
  // that satisfies the duck type rather than importing Prisma here.
  const v = value as { toNumber?: () => number };
  if (typeof v.toNumber === 'function') {
    return BigInt(roundHalfAwayFromZero(v.toNumber() * 100));
  }
  if (typeof value === 'number') {
    return BigInt(roundHalfAwayFromZero(value * 100));
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return BigInt(roundHalfAwayFromZero(n * 100));
  }
  return null;
}

function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value >= 0 ? Math.round(value) : -Math.round(-value);
}
