/**
 * Shared money formatting helpers for every Next.js app + the backend
 * presentation layer.
 *
 * All money in the SportSmart system is stored as paise (1/100 of an
 * Indian Rupee) using a 64-bit BigInt on the backend. The frontend
 * receives paise as either a plain `number` (for values that fit in a
 * JS-safe integer) or a string (for values > 2^53 — Razorpay
 * settlement aggregates, e-invoice limits, etc.).
 *
 * NEVER do `Number(bigint)` on values > Number.MAX_SAFE_INTEGER (≈ 9
 * lakh rupees in paise). Those silently round off the last digits and
 * an admin viewing a settlement total of ₹10,000,000.42 would see a
 * value that differs in the 1-paise place. Use `paiseToRupees`
 * instead, which goes through BigInt internally.
 *
 * Conversion rules:
 *   - 1 rupee = 100 paise
 *   - Display rounds to 2 decimal places (paise precision)
 *   - Indian-numbering commas (1,00,000 not 100,000) at the lakh /
 *     crore positions — this matches how Indian financial documents
 *     are read and what auditors expect on the printed page.
 */

export type PaiseValue = number | string | bigint;

/**
 * Coerce a paise value (number / string / bigint) to a BigInt safely.
 * Strings are validated as integer-only — passing "12.34" throws, since
 * that's a rupee value mistakenly passed as a paise value.
 */
export function toPaiseBigInt(paise: PaiseValue): bigint {
  if (typeof paise === 'bigint') return paise;
  if (typeof paise === 'number') {
    if (!Number.isFinite(paise)) {
      throw new RangeError(`Invalid paise value: ${paise}`);
    }
    if (!Number.isInteger(paise)) {
      throw new RangeError(
        `Paise must be integer (got ${paise}). Did you pass a rupee value? Use rupeesToPaise() instead.`,
      );
    }
    return BigInt(paise);
  }
  if (typeof paise === 'string') {
    const trimmed = paise.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new RangeError(
        `Paise string must be a plain integer (got "${paise}"). Use rupeesToPaise() if this is a rupee value.`,
      );
    }
    return BigInt(trimmed);
  }
  throw new TypeError(`Unsupported paise type: ${typeof paise}`);
}

/**
 * Format a paise value as a plain Indian-rupee string. Returns
 * `"1,23,456.78"` for `12345678` paise (no ₹ prefix — the caller adds
 * it if they want one).
 *
 * For values outside the safe-integer range, BigInt arithmetic is used
 * internally so there is no precision loss.
 */
export function paiseToRupees(paise: PaiseValue): string {
  const bi = toPaiseBigInt(paise);
  const negative = bi < 0n;
  const abs = negative ? -bi : bi;
  const rupees = abs / 100n;
  const paiseRem = abs % 100n;

  const rupeesStr = formatBigIntWithIndianGroups(rupees);
  const paiseStr = paiseRem.toString().padStart(2, '0');
  const sign = negative ? '-' : '';
  return `${sign}${rupeesStr}.${paiseStr}`;
}

/**
 * Format with the ₹ prefix — most UIs want this directly.
 */
export function paiseToRupeesString(paise: PaiseValue): string {
  return `₹${paiseToRupees(paise)}`;
}

/**
 * Convert rupees (a number or numeric string that may have up to 2
 * decimal places) to paise (BigInt). The string detour is deliberate
 * — `Math.round(123.45 * 100)` is correct for most values but drifts
 * on edge cases like `0.1 + 0.2`. Doing the split via string keeps
 * the calculation exact.
 */
export function rupeesToPaise(rupees: number | string): bigint {
  if (typeof rupees === 'number') {
    if (!Number.isFinite(rupees)) {
      throw new RangeError(`Invalid rupee value: ${rupees}`);
    }
    rupees = rupees.toFixed(2);
  }
  const trimmed = String(rupees).trim();
  const m = trimmed.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) {
    throw new RangeError(
      `Rupee value must look like "1234.56" or "1234" (got "${rupees}")`,
    );
  }
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = BigInt(m[2]);
  const fracStr = (m[3] ?? '').padEnd(2, '0');
  const frac = BigInt(fracStr.slice(0, 2));
  return sign * (whole * 100n + frac);
}

/**
 * Place commas at lakh/crore positions per Indian numbering convention.
 * Pure string manipulation on the BigInt — no Intl, because
 * Intl.NumberFormat does not accept BigInt across all Node versions
 * we ship, and we want identical output between server-rendered PDF
 * lines and client-rendered admin tables.
 *
 * Examples:
 *   1234        → "1,234"
 *   12345       → "12,345"
 *   123456      → "1,23,456"
 *   1234567     → "12,34,567"
 *   12345678    → "1,23,45,678"
 *   123456789   → "12,34,56,789"
 */
function formatBigIntWithIndianGroups(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const restWithCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${restWithCommas},${last3}`;
}
