# ADR-004: Money Value Object

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 1.2 of the 10-phase Returns + Disputes redesign

## Context

The codebase mixes two money representations today:

* **Decimal rupees** (`@db.Decimal(10, 2)` Prisma columns, deserialized as `Prisma.Decimal`) — used in catalog, commission, discounts, orders, COD, post-office, own-brand, franchise, seller-product-mapping, affiliate.
* **Integer paise** (`Int` Prisma column, plain JS `number` in code) — used in payments, wallet, reconciliation, disputes (`decisionAmountInPaise`).

This is fragile:

1. Cross-domain calls require ad-hoc `× 100` and `÷ 100` glue. Easy to drop precision.
2. Decimal arithmetic in JS uses `Prisma.Decimal` (a string-backed bigint shim), but everywhere else the value is a plain `number` — so `subOrder.amount + tax` silently mixes types.
3. The `Decimal @db.Decimal(10, 2)` columns max out at ₹99,999,999.99 — adequate for line items but uncomfortable for settlement totals. Paise as `Int` (32-bit) maxes at ₹2.1B; as `BigInt` it's effectively unbounded.
4. `Math.round(0.5) === 1` but `Math.round(-0.5) === 0`. Half-paise reversal entries were rounding asymmetrically — once we noticed, we fixed it locally; this consolidates.

## Decision

Introduce a single canonical `Money` value object: `apps/api/src/core/value-objects/money.ts`.

### Shape

```ts
class Money {
  readonly amountInPaise: number;   // integer, signed
  readonly currency: 'INR';

  static fromPaise(amount, currency = 'INR'): Money;
  static fromRupees(amount, currency = 'INR'): Money;  // rounds half-away-from-zero
  static zero(currency = 'INR'): Money;
  static roundHalfUp(value: number): number;            // public so tests can pin

  add(other: Money): Money;
  subtract(other: Money): Money;
  multiply(factor: number): Money;

  equals(other: Money): boolean;
  lessThan / greaterThan(other: Money): boolean;

  isZero / isPositive / isNegative(): boolean;

  toRupees(): number;
  displayString(locale = 'en-IN'): string;
  toJSON(): { amountInPaise; currency; displayInr };
}
```

### Wire format (the JSON contract)

Every API response that ships money returns the value via `Money.toJSON()` so clients see all three pieces:

```json
{
  "amountInPaise": 1234500,
  "currency": "INR",
  "displayInr": "₹12,345.00"
}
```

Frontends never have to reimplement `Intl.NumberFormat` — and any locale-specific formatting we change later updates everywhere at once.

### Rounding: half-away-from-zero

Both Razorpay and the RBI INR conventions round half-paise away from zero (`+0.5 → 1`, `-0.5 → -1`). JS's `Math.round` does this for positives but rounds halves toward `+Infinity` for negatives (`Math.round(-0.5) === 0`). The `roundHalfUp` helper branches on sign so reversal entries round symmetrically with their forward counterparts.

### Currency type-safety

The `currency` field is a discriminated union. Mixing INR and a future currency throws `TypeError` at runtime. We keep this strict because every loose comparison we relax now becomes a vulnerability the day a second currency lands.

### Float-precision caveat (known limitation)

`Money.fromRupees(1.005)` returns `100` paise, not `101`, because `1.005` in IEEE 754 is actually stored as `1.0049999999999999`. Callers who need exact rounding at half-paise boundaries should pass paise directly via `fromPaise(amountInPaise)`. The unit test `does NOT promise exact half-paise rounding for fromRupees(1.005)` pins this behaviour so no one silently "fixes" it without a deliberate decision (the right fix would be to swap `number` for a string-decimal library — out of scope for Phase 1.2).

## Consequences

### Positive

* Single canonical money type across the platform.
* Every monetary API response carries the same JSON shape.
* Compile-time prevention of currency mixing.
* Centralised, symmetric, documented rounding.
* Sets up Phase 1.4 (Decimal → paise migration): existing `*InPaise: number` callers can migrate to `Money` opportunistically without behaviour change.

### Negative / costs

* Adopting in existing code is a slow burn (Phase 1.4). Until then, there are two ways to talk about money in the codebase. Mitigated by leaving `*InPaise: number` parameters in place and only introducing `Money` at new boundaries.
* Float-precision rounding for `fromRupees` is not exact at half-paise boundaries. Documented + tested.

### Risks and rollback

* **Risk**: a future currency that uses fewer than 100 minor units (JPY, KRW) or a non-decimal currency (Bitcoin, satoshis) requires the `MINOR_UNITS` table. Easy fix.
* **Rollback**: nothing depends on this yet. Deleting the file wouldn't affect any API.

## Alternatives considered

* **Use `Prisma.Decimal` everywhere.** Ties domain code to Prisma — DDD anti-pattern. Slower for in-memory arithmetic.
* **Use a third-party library (`dinero.js`, `currency.js`).** Both fine, but our needs are narrow and we'd rather not add a dep for ~70 lines of behaviour. Easy to swap to a library later if needed.
* **`BigInt` instead of `number` for `amountInPaise`.** Adds JSON-serialization friction (`BigInt` is not natively serializable). The 2^53 paise limit (~₹90 trillion) is more than enough for any single transaction. We can extend to BigInt for ledger sums if needed.

## References

* Martin Fowler — Money pattern: https://martinfowler.com/eaaCatalog/money.html
* Joda Money: https://www.joda.org/joda-money/
* Stripe API: https://stripe.com/docs/api/charges (smallest-currency-unit + currency code)
