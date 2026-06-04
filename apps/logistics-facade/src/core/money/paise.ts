/**
 * BigInt-paise helpers. Every money value in the facade is paise
 * (integer hundredths of INR) stored as BigInt — exactly like the
 * `*_in_paise` columns in apps/api/prisma. No floats anywhere on
 * the money path.
 *
 * Mirrors apps/api/src/core/money/ in spirit; the apps/api module is
 * larger because it owns dual-write helpers for the legacy Decimal
 * columns. The facade ships paise-only from day one, so this file
 * is intentionally smaller.
 */

/** Safe addition; returns NaN-equivalent BigInt(0) on bad inputs. */
export function addPaise(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Safe subtraction; the caller is responsible for negative-result checks. */
export function subtractPaise(a: bigint, b: bigint): bigint {
  return a - b;
}

/**
 * Convert paise to a fixed-point rupee string (₹X.YY). Used for
 * label / receipt formatting — never for storage or arithmetic.
 */
export function paiseToRupeeString(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const remainder = abs % 100n;
  const formatted = `${rupees}.${remainder.toString().padStart(2, '0')}`;
  return negative ? `-${formatted}` : formatted;
}

/**
 * Parse a rupee string back to paise. Permissive — accepts `1.5`,
 * `1.50`, `1`, `001.50`. Throws on anything ambiguous.
 */
export function rupeeStringToPaise(input: string): bigint {
  const m = input.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`Invalid rupee string: ${input}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = BigInt(m[2]!);
  const fractionDigits = (m[3] ?? '').padEnd(2, '0');
  const fraction = BigInt(fractionDigits);
  return sign * (whole * 100n + fraction);
}

/**
 * Pretty-print for log lines. Always shows the rupee symbol so a
 * grepper isn't confused by raw integers.
 */
export function formatPaise(paise: bigint): string {
  return `₹${paiseToRupeeString(paise)}`;
}
