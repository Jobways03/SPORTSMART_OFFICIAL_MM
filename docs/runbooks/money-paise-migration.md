# Runbook — Money Paise Dual-Write Migration

Owner: returns-platform team. ADR-007.

## What it is

Phase 1.4 added `*_in_paise BIGINT` columns next to every Decimal money column on the dispute / return / settlement / commission / COD critical path. Behind `MONEY_DUAL_WRITE_ENABLED`, the `MoneyDualWriteHelper` populates the paise siblings on every write that opts in.

Three-stage cutover:

1. **PR 1.4** (this) — schema additions, backfill, opt-in helper. Flag default OFF.
2. **PR 1.4b** — switch read paths in services to paise. Flag must be ON in prod.
3. **PR 1.7** — drop the Decimal columns once paise reads have soaked for 2 weeks.

## Deploy checklist (PR 1.4)

```bash
# 1. Apply the schema migration. Backfill is part of the same SQL.
pnpm --filter @sportsmart/api prisma:deploy

# 2. Verify per-table parity (see queries below). Should be zero drift.

# 3. Flip the flag in staging.
echo "MONEY_DUAL_WRITE_ENABLED=true" >> staging-env

# 4. Soak for 2 weeks. Re-run parity queries weekly.

# 5. After soak, propose PR 1.4b (read-path switch).
```

## Per-table parity queries (run after migration)

```sql
-- returns.refund_amount
SELECT
  count(*)                                          AS rows,
  count(*) FILTER (
    WHERE refund_amount IS NOT NULL AND
          ROUND(refund_amount * 100)::BIGINT <> refund_amount_in_paise
  )                                                 AS drift_count,
  sum(refund_amount)                                AS sum_decimal,
  sum(refund_amount_in_paise)::NUMERIC / 100        AS sum_paise_as_rupees
FROM returns;

-- return_items.refund_amount
SELECT
  count(*)                                          AS rows,
  count(*) FILTER (
    WHERE refund_amount IS NOT NULL AND
          ROUND(refund_amount * 100)::BIGINT <> refund_amount_in_paise
  )                                                 AS drift_count
FROM return_items;

-- refund_transactions.amount
SELECT
  count(*)                                          AS rows,
  count(*) FILTER (
    WHERE ROUND(amount * 100)::BIGINT <> amount_in_paise
  )                                                 AS drift_count,
  sum(amount)                                       AS sum_decimal,
  sum(amount_in_paise)::NUMERIC / 100               AS sum_paise_as_rupees
FROM refund_transactions;

-- master_orders.total_amount + discount_amount
SELECT
  count(*)                                          AS rows,
  count(*) FILTER (
    WHERE ROUND(total_amount * 100)::BIGINT <> total_amount_in_paise
  )                                                 AS total_drift,
  count(*) FILTER (
    WHERE ROUND(discount_amount * 100)::BIGINT <> discount_amount_in_paise
  )                                                 AS discount_drift
FROM master_orders;

-- (similar pattern for sub_orders, order_items, settlement_cycles,
--  seller_settlements, settlement_adjustments, commission_settings,
--  commission_records, commission_reversal_records, cod_decision_logs,
--  payouts — full list in tracker.sql)
```

`drift_count` should be **0** on every table. Any non-zero value blocks PR 1.4b until investigated.

## Symptoms

### Drift reported by recon

A `*_in_paise` column doesn't match `ROUND(decimal * 100)::BIGINT`.

**Likely causes**:

1. A service writes the Decimal column without going through `MoneyDualWriteHelper.applyPaise()`. Find the offender:

   ```bash
   grep -rn "prisma\.\(return\|orderItem\|commissionRecord\)\..*\(refundAmount\|amount\|unitPrice\)" src/ \
     | grep -v 'applyPaise\|\.spec\.ts'
   ```

2. The flag is OFF in prod (paise sibling stays at 0/null on writes; reads of 0 vs the actual Decimal value diverge over time).

3. Manual SQL UPDATE bypassing the helper — DBA fix only.

**Fix**:

```sql
-- One-shot re-backfill of a specific column
UPDATE my_table
   SET refund_amount_in_paise = ROUND(refund_amount * 100)::BIGINT
 WHERE refund_amount_in_paise IS DISTINCT FROM
       ROUND(refund_amount * 100)::BIGINT;
```

### Test failures: BigInt serialization

`JSON.stringify(BigInt(1))` throws `TypeError`. If a fixture serializes a Money read directly into a snapshot, it'll fail.

**Fix**: convert at the boundary — `Number(record.refundAmountInPaise)` for any value where `< 2^53`. Or use the Money VO from ADR-004 which exposes `amountInPaise: number`.

### "I called applyPaise but the column is still 0"

The flag is off. `MoneyDualWriteHelper.applyPaise` is a no-op when `MONEY_DUAL_WRITE_ENABLED=false` and returns the input unchanged. Set `MONEY_DUAL_WRITE_ENABLED=true` in your env.

## How to wire a service

```ts
// 1. Inject the helper
constructor(
  private readonly prisma: PrismaService,
  private readonly moneyDualWrite: MoneyDualWriteHelper, // <-- add
) {}

// 2. Wrap the data on every write
await this.prisma.return.update({
  where: { id },
  data: this.moneyDualWrite.applyPaise('return', {
    status: 'REFUNDED',
    refundAmount: total,
    refundProcessedAt: new Date(),
  }),
});

// 3. createMany variant
await this.prisma.orderItem.createMany({
  data: this.moneyDualWrite.applyPaiseMany('orderItem', items),
});
```

Compatibility: callers that don't update the paise column don't break. The helper just doesn't add a paise field, and the existing default (`0`) sticks.

## Operating envelope

| Knob | Default | Recommended |
|---|---|---|
| `MONEY_DUAL_WRITE_ENABLED` | `false` | `true` after staging soak |

## Rollback

Set the flag to `false`. Existing paise columns retain whatever values were last written; a future flag-on plus a one-shot re-backfill (see Drift fix above) catches up. The schema columns themselves are additive — leave them.

## Test in pre-prod

```bash
# Submit a return — admin marks refund_amount.
# Without the flag the paise column stays at 0:
psql -c "SELECT refund_amount, refund_amount_in_paise FROM returns WHERE id = 'r-1';"
# refund_amount = 1234.56,  refund_amount_in_paise = 0  ← expected at flag-OFF

# Flip the flag, redo the same write:
echo "MONEY_DUAL_WRITE_ENABLED=true" >> .env
# (restart, redo write)
psql -c "SELECT refund_amount, refund_amount_in_paise FROM returns WHERE id = 'r-1';"
# refund_amount = 1234.56,  refund_amount_in_paise = 123456  ← lockstep
```
