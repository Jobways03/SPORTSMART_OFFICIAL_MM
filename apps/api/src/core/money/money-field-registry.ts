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
 * Convert a rupee-valued input to integer paise as a `BigInt`.
 *
 * Accepts:
 *   - `Prisma.Decimal` (from DB reads) — converted via the Decimal
 *     library's own arithmetic (`mul(100).toFixed(0)`), which is exact.
 *   - `string` — parsed character-by-character so JS float arithmetic
 *     never touches the value (e.g. `"0.1"` + `"0.2"` performed by the
 *     caller as Decimal will arrive here as `"0.3"`, not `0.30000…04`).
 *   - `bigint` — assumed whole rupees; multiplied by 100.
 *   - integer `number` — multiplied by 100 in BigInt space.
 *   - `null` / `undefined` → returns `null` (caller decides).
 *
 * Rejects:
 *   - **fractional `number`** — the value has already lost precision
 *     before reaching this function. The thrown error is the upstream
 *     fix signal: pass a `Decimal` or a string instead. This is the
 *     core of PR 0.4; the previous implementation silently rounded.
 *   - malformed strings → returns `null`.
 *
 * Rounding: half-up at the third decimal position for strings.
 * `Decimal` uses its library default (`ROUND_HALF_EVEN`) on `.toFixed`,
 * which is bankers' rounding and matches the platform-wide convention
 * documented in the Money value-object (`core/value-objects/money.ts`).
 */
export function toPaise(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;

  // ── Prisma.Decimal-like (preferred path) ────────────────────────
  // Duck-typed on `.mul + .toFixed`. We deliberately do NOT use
  // `.toNumber()` here — that's the old lossy path that motivated this
  // rewrite. Decimal libraries (`decimal.js`, `decimal.js-light` —
  // Prisma uses the latter) compute `.mul(100)` exactly and
  // `.toFixed(0)` returns a canonical integer string.
  const d = value as {
    mul?: (x: number | string) => unknown;
    toFixed?: (n: number) => string;
  };
  if (typeof d.mul === 'function' && typeof d.toFixed === 'function') {
    const scaled = d.mul(100) as { toFixed: (n: number) => string };
    return BigInt(scaled.toFixed(0));
  }

  if (typeof value === 'bigint') {
    // Caller passed whole rupees in BigInt form (rare). Convert to
    // paise. Stays in BigInt space so no precision loss.
    return value * 100n;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (!Number.isInteger(value)) {
      // Phase 0 (PR 0.4) — silent precision drift was the original
      // hazard. Refuse to convert fractional JS numbers; the caller
      // must pass a `Decimal` or a string. This throws loudly so the
      // upstream bug surfaces in dev/staging rather than corrupting
      // ledger entries in prod.
      throw new RangeError(
        `toPaise: refusing to convert fractional Number ${value} ` +
          `(precision already lost). Pass a Decimal or a decimal-string instead.`,
      );
    }
    return BigInt(value) * 100n;
  }

  if (typeof value === 'string') {
    return stringRupeesToPaise(value);
  }

  return null;
}

/**
 * Parse a decimal-string of rupees (e.g. `"1234.56"`, `"-99.5"`,
 * `"1234567890.45"`) into integer paise. Rounds half-up at the third
 * decimal position. Returns `null` for malformed input.
 *
 * Done with string arithmetic so JS float can never touch the value.
 */
function stringRupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracRaw = ''] = unsigned.split('.');

  // Pad to at least 3 fractional digits so we can examine position 3
  // for half-up rounding. e.g. "1.5" → "500"; "1.555" → "555".
  const fracPadded = (fracRaw + '000').slice(0, 3);
  const twoDigits = fracPadded.slice(0, 2);
  const roundDigit = fracPadded.charCodeAt(2) - 48; // '0'..'9' → 0..9

  // Drop leading zeros but keep a single "0" so BigInt('') doesn't throw.
  const paiseDigits = (intPart + twoDigits).replace(/^0+(?=\d)/, '');
  let paise = BigInt(paiseDigits);
  if (roundDigit >= 5) paise += 1n;

  return negative ? -paise : paise;
}
