# ADR-007: Decimal → Paise Dual-Write Money Migration

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 1.4 of the 10-phase Returns + Disputes redesign

## Context

Money in the codebase today lives in two parallel representations:

* **`Decimal @db.Decimal(*, 2)` rupees** — used in catalog, commission, discounts, orders, COD, settlements, post-office, own-brand, franchise, seller-product-mapping, affiliate, returns. Most of the business surface.
* **`Int paise`** — used in payments, wallet, reconciliation, disputes (`decisionAmountInPaise`).

Cross-domain math (refund decision in paise → return record in rupees → commission reversal in rupees → settlement total in rupees → wallet credit in paise) requires repeated `× 100` / `÷ 100` glue and quietly accumulates float drift. ADR-004 introduced `Money` as the canonical value object; this ADR is about getting the underlying schema to match.

## Decision

Add a `*_in_paise BIGINT` sibling to every Decimal money column on the redesign's critical path, dual-write the columns for a soak window, then make paise authoritative and drop the Decimal columns.

The cutover is staged in **three PRs** to keep blast radius bounded:

| PR | What lands |
|---|---|
| **PR 1.4** (this) | Schema + backfill + opt-in `MoneyDualWriteHelper`. Decimal stays authoritative. |
| PR 1.4b (later) | Switch read paths to paise via the helper. Decimal still written but no longer read. |
| PR 1.7 (later still) | Drop the Decimal columns once parity holds for 2 weeks. |

### Scope of THIS PR

Critical-path columns only — 37 columns across 5 schemas:

| Schema | Tables | Money columns added (paise) |
|---|---|---|
| `returns.prisma` | `returns`, `return_items`, `refund_transactions` | 3 |
| `orders.prisma` | `master_orders`, `sub_orders`, `order_items` | 5 |
| `settlements.prisma` | `settlement_cycles`, `seller_settlements`, `settlement_adjustments` | 6 |
| `commission.prisma` | `commission_settings`, `commission_records`, `commission_reversal_records` | 21 |
| `cod-payouts.prisma` | `cod_decision_logs`, `payouts` | 2 |

The remaining money columns — catalog (Product / ProductVariant prices), discounts, franchise, affiliate, own-brand — are deferred. Those domains aren't being mutated by the 10-phase plan; they can migrate organically later.

### Why BIGINT, not INTEGER

Existing `Wallet.balanceInPaise` uses `Int` (4-byte INTEGER, max ~2.1B paise = ₹21.4M). For a per-user wallet that's plenty. For aggregate columns (settlement cycle totals, master order totals) that limit is uncomfortably tight — a single bulk B2B order could exceed it. We use `BIGINT` everywhere for consistency and future-proofing. Prisma exposes `BigInt` to TS code; callers convert to `Number` at the application boundary (safe up to 2^53 paise ≈ ₹90 trillion).

### Why an opt-in helper instead of a Prisma client extension

Prisma v6 deprecates `$use` middleware and the alternative `$extends` produces a NEW client type. Replacing `PrismaService` with the extended client would force every consumer of `PrismaService` to update — a high-blast-radius change for what is conceptually a small dual-write.

Instead, we ship `MoneyDualWriteHelper.applyPaise(modelKey, data)` as an explicit augmenter that callers invoke before `prisma.x.create({ data })`. The registry shape (`MONEY_FIELD_REGISTRY`) is the same one a future Prisma extension would use, so swapping push for pull later is mechanical.

```ts
// Before (existing service code, unchanged at flag-OFF):
await this.prisma.return.update({
  where: { id }, data: { refundAmount: total },
});

// After (PR 1.4 — opt-in dual-write):
await this.prisma.return.update({
  where: { id },
  data: this.moneyDualWrite.applyPaise('return', { refundAmount: total }),
});
```

### Backfill semantics

Every `*_in_paise` column has a one-shot `UPDATE ... SET = ROUND(decimal * 100)::BIGINT` immediately after its `ALTER TABLE`. For NOT NULL columns the default is `0` so the column exists for in-flight transactions during the migration window; the UPDATE then overwrites those zeros with the correct value. For nullable columns (`refund_amount`, `original_admin_earning`, `max_commission_amount`, `order_total_inr`) the column also stays nullable; the UPDATE only runs where the source value is non-null.

ROUND uses the SQL-standard half-away-from-zero, which matches the application-side `Money.roundHalfUp`. After the migration, application-write paths and the backfill compute identical paise values for the same Decimal input — paise = `ROUND(decimal × 100)`.

### Reconciliation (verification post-migration)

After `prisma migrate deploy`, run the recon query in `docs/runbooks/money-paise-migration.md` per table:

```sql
SELECT
  count(*)                                                  AS rows,
  count(*) FILTER (WHERE ROUND(decimal_col * 100) <> paise_col) AS drift,
  sum(decimal_col)                                          AS sum_decimal,
  sum(paise_col)::numeric / 100                             AS sum_paise_in_rupees
FROM my_table;
```

`drift` should be `0`. Any non-zero value is investigated before flipping `MONEY_DUAL_WRITE_ENABLED` on (otherwise the flip would lock-in the drift).

## Consequences

### Positive

* Foundation laid for the dispute-decision → wallet-credit → settlement-reconciliation flow that Phases 2–5 build on, without ad-hoc `× 100` arithmetic at the boundary.
* Money VO (ADR-004) finally has a column type to bind to.
* Bigger column type (`BIGINT`) covers settlement aggregates without needing a follow-up "we ran out of integer bits" migration.
* Backfill query gives ops a one-shot recon point to verify the migration did what we expected.

### Negative / costs

* Schema is now temporarily fatter (Decimal + paise side-by-side) for the soak window. Storage cost is trivial (~12 bytes per row × 37 columns).
* Two writes per money mutation when the flag is on — an extra few microseconds per write that no one will measure.
* Callers that opt into `applyPaise()` need to remember to do so; flag-OFF leaves them as no-ops, but flag-ON without the helper call means the paise column stays at 0 / null and recon detects drift. The runbook documents this.

### Risks and rollback

* **Risk**: a service that doesn't opt into `applyPaise()` will not populate paise on update — the columns drift over time. Recon job (queued for Phase 8) catches this. Until Phase 8, manual recon SQL.
* **Risk**: a Decimal-to-paise rounding boundary that drifts from the SQL `ROUND` (e.g. banker's rounding vs half-away-from-zero) would produce ledger drift. Verified equal in `money-dual-write-helper.spec.ts` rounding tests; pinned in `Money.roundHalfUp` (ADR-004).
* **Rollback**: flip `MONEY_DUAL_WRITE_ENABLED=false`. Decimal columns remain authoritative as today. Paise columns hold whatever they were last written; a future flip-on plus recon will catch them up. The schema columns themselves can stay indefinitely — they're additive.

## Alternatives considered

* **Big-bang migration: drop Decimal, use only paise.** No soak; one bug = production outage. Refused.
* **Use `Int` (32-bit) like Wallet does.** Tight for settlement totals. Refused.
* **String-decimal library (`decimal.js`, `big.js`)** for fractional-paise precision. Out of scope for Phase 1; adds a dependency for a problem we don't have today.
* **Prisma `$extends` push-based middleware.** Fights the type system; high blast radius for retrofit. We may do this in PR 1.4-extended once the helper has soaked.

## References

* Phase 1.4 of the redesign brief.
* ADR-004 — Money value object (paise as canonical in-memory representation).
* `apps/api/src/core/money/money-field-registry.ts` — the authoritative list of money columns.
* `apps/api/src/core/money/money-dual-write.helper.ts` — opt-in augmenter.
* `apps/api/prisma/schema/migrations/20260505120000_add_paise_columns_critical_path/` — schema migration.
