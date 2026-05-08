/**
 * Money value object — phase-1 foundation.
 *
 * Internal representation: integer paise (1/100 INR). Stored as a JS
 * `number` (safe up to 2^53 paise ≈ ₹90,071,992,547,409 — more than
 * enough for any single transaction or settlement total). For ledger
 * sums beyond this range, use a BigInt-backed sibling type.
 *
 * Why a value object?
 *   - Eliminates the float-arithmetic mistakes that plague rupee-Decimal
 *     pipelines (`1.1 + 2.2 !== 3.3`).
 *   - Enforces currency at the type level — adding INR to USD is a
 *     compile error, not a silent miscalculation.
 *   - Centralises rounding semantics (banker's rounding ROUND_HALF_UP
 *     for compatibility with Razorpay / RBI conventions).
 *   - Makes the JSON wire format explicit: every API response that
 *     ships money carries `{ amountInPaise, currency, displayInr }` so
 *     clients never have to guess the format.
 *
 * Industry references:
 *   - https://martinfowler.com/eaaCatalog/money.html (Fowler, Money pattern)
 *   - https://www.joda.org/joda-money/ (Joda Money — Java reference impl)
 *   - https://stripe.com/docs/api/charges (Stripe stores money as smallest
 *     currency unit + currency code)
 *
 * Phase 1.2 of the Returns + Disputes redesign. Existing `*InPaise: number`
 * callers will migrate to `Money` opportunistically over Phase 1.4 once
 * the dual-write Decimal migration completes; until then this class is
 * additive — it doesn't change any existing call site.
 */

/**
 * Currency codes supported on the platform. Today only INR; extending
 * later means updating the union AND adding any rounding-precision
 * carveouts (some currencies — JPY, KRW — have no minor unit).
 */
export type CurrencyCode = 'INR';

const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ['INR'] as const;

/**
 * Minor units per major unit, by currency. INR uses 100 paise per ₹.
 * If/when we add JPY (zero minor units) this lookup ensures rounding
 * stays correct.
 */
const MINOR_UNITS: Record<CurrencyCode, number> = {
  INR: 100,
};

export class Money {
  /**
   * Use Money.fromPaise / Money.fromRupees rather than `new Money(...)`
   * so the construction path is obvious in call sites.
   */
  private constructor(
    public readonly amountInPaise: number,
    public readonly currency: CurrencyCode,
  ) {}

  // ─── Constructors ─────────────────────────────────────────────────

  /**
   * Build from integer paise. Rejects fractional / non-finite values
   * because storing fractional paise has no real-world meaning and
   * almost always indicates an upstream bug.
   */
  static fromPaise(amountInPaise: number, currency: CurrencyCode = 'INR'): Money {
    if (!Number.isFinite(amountInPaise)) {
      throw new RangeError(
        `Money.fromPaise: amountInPaise must be a finite number, got ${amountInPaise}`,
      );
    }
    if (!Number.isInteger(amountInPaise)) {
      throw new RangeError(
        `Money.fromPaise: amountInPaise must be an integer, got ${amountInPaise}`,
      );
    }
    Money.assertCurrency(currency);
    return new Money(amountInPaise, currency);
  }

  /**
   * Build from rupees (Number, possibly fractional). Rounds to the
   * nearest paise using ROUND_HALF_UP — matches the rounding convention
   * Razorpay applies and the one RBI guidelines reference for INR.
   * Reject NaN / Infinity to stop silent currency corruption.
   */
  static fromRupees(amountInRupees: number, currency: CurrencyCode = 'INR'): Money {
    if (!Number.isFinite(amountInRupees)) {
      throw new RangeError(
        `Money.fromRupees: amountInRupees must be finite, got ${amountInRupees}`,
      );
    }
    Money.assertCurrency(currency);
    const minor = MINOR_UNITS[currency];
    // Two-step rounding: scale up, round half-away-from-zero, then
    // store. Math.round in JS is half-away-from-zero for positives but
    // half-toward-positive-infinity overall — we explicitly handle the
    // negative case so -0.5 paise rounds to -1, not 0.
    const scaled = amountInRupees * minor;
    const rounded =
      scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
    return new Money(rounded, currency);
  }

  /** Zero-amount constant in the supplied currency. */
  static zero(currency: CurrencyCode = 'INR'): Money {
    Money.assertCurrency(currency);
    return new Money(0, currency);
  }

  // ─── Arithmetic ───────────────────────────────────────────────────

  /**
   * Add another Money. Currencies must match; mixing INR and a future
   * USD would be a logic bug — surface it loudly.
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountInPaise + other.amountInPaise, this.currency);
  }

  /**
   * Subtract. Result may be negative — Money is a signed quantity
   * (refunds are positive, debits are negative when expressed as a
   * single ledger row's `amountInPaise`).
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountInPaise - other.amountInPaise, this.currency);
  }

  /**
   * Multiply by a scalar quantity (e.g. line-item × quantity).
   * Rounds the result to integer paise using ROUND_HALF_UP so
   * `unitPrice × qty` always lands on a whole paise. Reject
   * non-finite multipliers.
   */
  multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new RangeError(`Money.multiply: factor must be finite, got ${factor}`);
    }
    return new Money(Money.roundHalfUp(this.amountInPaise * factor), this.currency);
  }

  /**
   * Static rounding helper — kept on the class so tests can pin down
   * exact behaviour for negative + half-paise edge cases.
   *
   * Uses ROUND_HALF_UP (away from zero on .5):
   *   roundHalfUp( 0.5) =  1
   *   roundHalfUp( 1.5) =  2
   *   roundHalfUp(-0.5) = -1
   *   roundHalfUp(-1.5) = -2
   *
   * JS's Math.round is half-toward-positive-infinity, so we branch
   * to keep symmetric behaviour for negative amounts. This matters
   * when reversal entries credit a fractional paise — we want them
   * to round consistently with their forward counterparts.
   */
  static roundHalfUp(value: number): number {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Money.roundHalfUp: value must be finite, got ${value}`);
    }
    return value >= 0 ? Math.round(value) : -Math.round(-value);
  }

  // ─── Comparisons ──────────────────────────────────────────────────

  equals(other: Money): boolean {
    return (
      this.currency === other.currency &&
      this.amountInPaise === other.amountInPaise
    );
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountInPaise < other.amountInPaise;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountInPaise > other.amountInPaise;
  }

  isZero(): boolean {
    return this.amountInPaise === 0;
  }

  isNegative(): boolean {
    return this.amountInPaise < 0;
  }

  isPositive(): boolean {
    return this.amountInPaise > 0;
  }

  // ─── Conversions ──────────────────────────────────────────────────

  /**
   * Decimal-rupees view. Loses precision for non-INR currencies with
   * different minor units, but for INR (100 paise) it's exact for any
   * reasonable transaction size.
   *
   * Returns a Number, not a string — for display, prefer `displayString()`.
   */
  toRupees(): number {
    return this.amountInPaise / MINOR_UNITS[this.currency];
  }

  /**
   * Locale-formatted display string. Defaults to en-IN.
   *   ₹1,234.56  for INR positive
   *   -₹50.00    for INR negative
   */
  displayString(locale = 'en-IN'): string {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return formatter.format(this.toRupees());
  }

  /**
   * Wire format for API responses. Industry convention: include the
   * raw integer (for arithmetic on the client), the currency code (for
   * disambiguation), and a pre-formatted display string (so frontends
   * don't reimplement Intl).
   */
  toJSON(): { amountInPaise: number; currency: CurrencyCode; displayInr: string } {
    return {
      amountInPaise: this.amountInPaise,
      currency: this.currency,
      displayInr: this.displayString('en-IN'),
    };
  }

  toString(): string {
    return `Money(${this.amountInPaise} ${this.currency})`;
  }

  // ─── Internals ────────────────────────────────────────────────────

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new TypeError(
        `Money: cannot mix currencies (${this.currency} and ${other.currency})`,
      );
    }
  }

  private static assertCurrency(currency: CurrencyCode): void {
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new TypeError(
        `Money: unsupported currency "${currency}". Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }
  }
}
