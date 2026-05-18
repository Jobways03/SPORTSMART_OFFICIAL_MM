# Money paise cutover — runbook

**Audience:** platform + finance engineers planning the retirement
of the legacy `Decimal` money columns.

**Last updated:** 2026-05-16 (Phase 12). Owners: platform team.

## Context

ADR-007 set the future for money columns: every paise figure lives
as a `BigInt`-typed column suffixed `…InPaise`. The migration to
that future is staged — Phase 1.4 added every paise column as a
**sibling** alongside the existing `Decimal`, with the application
layer dual-writing both via `MoneyDualWriteHelper`. The plan was
always to retire the `Decimal` siblings once every read site moved
across.

This doc names the schemas + columns still on dual-write, the order
of cutover, and the per-module steps for retiring each sibling.

---

## Inventory of dual-write columns

Counted from `prisma/schema/*.prisma` as of 2026-05-16. The number
is the count of `…InPaise` columns each schema carries; in most
cases there's an equivalent `Decimal` sibling column for each.

| Schema | paise cols | Notes |
|--------|---:|------|
| `orders.prisma`            | 34 | MasterOrder + SubOrder + OrderItem totals |
| `commission.prisma`        | 21 | CommissionRecord + CommissionSetting |
| `tax-documents.prisma`     | 18 | TaxDocument + TaxDocumentLine (GST) |
| `returns.prisma`           | 11 | Return refund + restock fees |
| `wallet.prisma`            | 10 | Wallet, WalletTransaction (only paise — no Decimal sibling) |
| `gst-tcs.prisma`           | 10 | GstTcsSettlementLedger |
| `settlements.prisma`       |  7 | SettlementCycle + SellerSettlement totals |
| `discounts.prisma`         |  7 | Discount + DiscountApplication |
| `reconciliation.prisma`    |  6 | ReconciliationDiff |
| `payments.prisma`          |  3 | Payment, Refund |
| `liability-ledger.prisma`  |  3 | LiabilityLedgerEntry |
| `shipping.prisma`          |  2 | ShippingLabel cost |
| `refund-instructions.prisma`| 2 | RefundInstruction amount |
| `cod-payouts.prisma`       |  2 | CodPayout collected vs payable |
| `tax-master.prisma`        |  1 | TaxRate snapshot |

Totals: ~137 paise columns across 15 schemas. Most paired with a
Decimal sibling; `wallet.prisma` is the exception (paise-only since
day one).

## Cutover order

Retire schemas in this order. Each step is its own PR.

```
Step 1.  Wallet (already paise-only — no action; sentinel for the
         template).
Step 2.  Refund-instructions   — 2 cols, lowest blast radius.
Step 3.  Cod-payouts            — 2 cols.
Step 4.  Shipping              — 2 cols.
Step 5.  Tax-master            — 1 col.
Step 6.  Payments              — 3 cols.
Step 7.  Liability-ledger      — 3 cols.
Step 8.  Reconciliation        — 6 cols.
Step 9.  Discounts             — 7 cols.
Step 10. Settlements           — 7 cols.
Step 11. Gst-tcs               — 10 cols.
Step 12. Returns               — 11 cols.
Step 13. Tax-documents         — 18 cols (GST invoices; legal hold).
Step 14. Commission            — 21 cols.
Step 15. Orders                — 34 cols (last — highest blast radius).
```

Rationale: smaller schemas first lets us drain the per-PR risk
budget without compounding. Orders + tax-documents go last because
they touch the highest-volume code paths.

## Per-schema cutover steps

For each schema, the PR follows this template:

1. **Grep every read site** of the Decimal column. Use the file:line
   list to verify each one is also reading the paise sibling (or
   could trivially switch).
2. **Switch reads to paise.** Conversions to rupees for display
   happen at the response-mapper layer via `paiseToRupeesString`
   from `@sportsmart/shared-utils`. No raw `Number(BigInt)` calls
   in business logic — that loses precision past 2^53 paise.
3. **Switch writes to paise.** The legacy `MoneyDualWriteHelper`
   already does this for new writes; the PR just deletes the
   helper invocation now that no read depends on the Decimal sibling.
4. **Migration: drop the Decimal column.** A safe drop pattern:
   ```sql
   ALTER TABLE <table> DROP COLUMN <decimal_column>;
   ```
   Do this in a follow-up migration AFTER the read+write cutover
   has been in prod for at least 7 days, so rollback to a previous
   image doesn't reintroduce dependence on the missing column.
5. **Spec coverage.** Add or update spec tests asserting:
   - The endpoint returns the paise value verbatim AND a rupees
     string formatted via `paiseToRupeesString`.
   - The repository write path inserts only the paise column.
   - A regression test for the schema (the column literally must
     not exist) — using `prisma db pull` snapshot diffing.

## Invariants to preserve during cutover

* **Money never represented as `number`.** Paise values can exceed
  `Number.MAX_SAFE_INTEGER` for platform-level rollups (anything
  over ~₹90,071,992 in paise). All arithmetic stays in BigInt.
* **Sign convention.** Positive = inflow / credit; negative =
  outflow / debit. The existing `liability-ledger.prisma` uses
  this convention and other schemas mirror it.
* **Currency code.** INR-only today, but the column is reserved
  on every paise model for the future multi-currency story. Never
  treat the field as a label — quote it in payouts / reports.

## Rollback

The Decimal sibling is the rollback handle. Until a schema's PR is
merged + soaked for 7 days, the Decimal column is the source of
truth that ops can fall back on. After the soak completes, the
Decimal column is dropped (irreversible without a restore-from-
backup); a regression PR can revert to the previous image but
cannot reinstate the column.

## Open questions

* `wallet.prisma` is paise-only and works fine. Did anything break
  on the way that we should mirror in the cutover sequence? Yes —
  the wallet payout summary endpoint that used to divide by 100 to
  show rupees was the long pole on the wallet cutover. Pre-fix:
  every wallet adjacent display surface should be re-verified.
* `tax-documents.prisma` is on a legal retention schedule. Verify
  with finance that dropping the Decimal sibling doesn't break the
  CA's audit-trail expectations (GSTR-1 / GSTR-3B exports). The
  CA pack at `docs/CA_TAX_REVIEW_PACK_2026_05_16.md` lists what
  they expect; cross-check before scheduling step 13.

---

## Tracking

Owner: platform team. Each step opens a single PR. The "blocked by
finance review" tag goes on steps 11 (gst-tcs) and 13 (tax-documents)
until the CA signs off.
