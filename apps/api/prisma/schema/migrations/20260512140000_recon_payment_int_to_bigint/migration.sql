-- Phase 2 (PR 2.3) — widen reconciliation and payment-mismatch money
-- columns from INTEGER to BIGINT.
--
-- Why these tables, why now:
--   * reconciliation_runs: aggregates an entire day's worth of order
--     totals; even modest-scale GMV trivially overflows INT max
--     (₹21,474,836). Pre-PR, the service had a `bigintPaiseToInt`
--     clamp helper that swallowed the overflow with a log warning —
--     useful as a stopgap, harmful as a permanent fixture because
--     the recon report quietly lied about the total.
--   * reconciliation_discrepancies: per-discrepancy rows carry the
--     same amounts; a single B2B-scale order's discrepancy can
--     approach INT max on its own.
--   * payment_mismatch_alerts: surfaces gateway / order amount
--     mismatches. Same logic as reconciliation_discrepancies.
--
-- ALTER COLUMN ... TYPE BIGINT is a catalog-only update on Postgres:
-- every INT value already fits inside a BIGINT bit-for-bit, so no
-- table rewrite is required. Acquires an ACCESS EXCLUSIVE lock for
-- the duration of the catalog flip, which is microseconds on these
-- tables (low row counts compared to orders/items).

ALTER TABLE "reconciliation_runs"
  ALTER COLUMN "expected_amount_in_paise" TYPE BIGINT,
  ALTER COLUMN "matched_amount_in_paise"  TYPE BIGINT;

ALTER TABLE "reconciliation_discrepancies"
  ALTER COLUMN "expected_in_paise" TYPE BIGINT,
  ALTER COLUMN "actual_in_paise"   TYPE BIGINT;

ALTER TABLE "payment_mismatch_alerts"
  ALTER COLUMN "expected_in_paise" TYPE BIGINT,
  ALTER COLUMN "actual_in_paise"   TYPE BIGINT;
