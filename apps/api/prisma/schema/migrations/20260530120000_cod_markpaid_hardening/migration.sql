-- Phase 168 — COD Mark-Paid Flow audit remediation.
--
-- Adds cash-collection provenance to orders, a dedicated CashCollection ledger,
-- a per-sub-order paid trail, the COD_COLLECTION_OVERDUE admin-task kind, and
-- the index the cod-collection-pending recon cron needs.

-- ── #11: new admin-task kind for the COD-collection-overdue queue ────────────
-- (ADD VALUE only — not used elsewhere in this migration, so it is transaction-safe on PG 12+.)
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'COD_COLLECTION_OVERDUE';

-- ── #3/#9/#14: COD cash-collection quick-answer columns on master_orders ─────
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "paid_by"                   TEXT,
  ADD COLUMN IF NOT EXISTS "paid_at"                   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_reference"         TEXT,
  ADD COLUMN IF NOT EXISTS "payment_notes"             TEXT,
  ADD COLUMN IF NOT EXISTS "collected_amount_in_paise" BIGINT;

-- ── #3/#10: per-sub-order paid trail ────────────────────────────────────────
ALTER TABLE "sub_orders"
  ADD COLUMN IF NOT EXISTS "paid_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paid_by"           TEXT,
  ADD COLUMN IF NOT EXISTS "payment_reference" TEXT;

-- ── #4/#9: CashCollection ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_collections" (
  "id"                        TEXT NOT NULL,
  "master_order_id"           TEXT NOT NULL,
  "sub_order_id"              TEXT,
  "expected_amount_in_paise"  BIGINT NOT NULL,
  "collected_amount_in_paise" BIGINT NOT NULL,
  "variance_in_paise"         BIGINT NOT NULL DEFAULT 0,
  "variance_reason"           TEXT,
  "collection_reference"      TEXT,
  "notes"                     TEXT,
  "collected_by_admin_id"     TEXT,
  "collected_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_collections_pkey" PRIMARY KEY ("id")
);

-- variance MUST equal collected - expected (defence-in-depth against a writer
-- that forgets to compute it). Money invariant, DB-enforced.
ALTER TABLE "cash_collections"
  ADD CONSTRAINT "cash_collections_variance_check"
  CHECK ("variance_in_paise" = "collected_amount_in_paise" - "expected_amount_in_paise");

-- amounts are non-negative paise.
ALTER TABLE "cash_collections"
  ADD CONSTRAINT "cash_collections_amounts_nonneg_check"
  CHECK ("expected_amount_in_paise" >= 0 AND "collected_amount_in_paise" >= 0);

ALTER TABLE "cash_collections"
  ADD CONSTRAINT "cash_collections_master_order_id_fkey"
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cash_collections_master_order_id_idx"      ON "cash_collections"("master_order_id");
CREATE INDEX IF NOT EXISTS "cash_collections_sub_order_id_idx"         ON "cash_collections"("sub_order_id");
CREATE INDEX IF NOT EXISTS "cash_collections_collected_by_admin_id_idx" ON "cash_collections"("collected_by_admin_id");
CREATE INDEX IF NOT EXISTS "cash_collections_collected_at_idx"         ON "cash_collections"("collected_at");

-- ── #11: index for the cod-collection-pending recon cron ────────────────────
CREATE INDEX IF NOT EXISTS "master_orders_payment_method_order_status_payment_status_idx"
  ON "master_orders"("payment_method", "order_status", "payment_status");
