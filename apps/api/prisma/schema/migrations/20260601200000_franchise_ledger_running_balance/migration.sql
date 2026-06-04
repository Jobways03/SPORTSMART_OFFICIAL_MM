-- Phase 181 (Franchise Ledger audit) — running-balance double-entry columns,
-- queryable actor, idempotency dedup, status-history table. All additive; the
-- backfill reconstructs debit/credit/balance from the existing rows.

-- ── 1. New columns ──────────────────────────────────────────────────────────
ALTER TABLE "franchise_finance_ledger"
  ADD COLUMN "debit_in_paise"          BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN "credit_in_paise"         BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN "balance_after_in_paise"  BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN "currency"                TEXT    NOT NULL DEFAULT 'INR',
  ADD COLUMN "created_by_admin_id"     TEXT,
  ADD COLUMN "created_by_system"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "idempotency_key"         TEXT;

ALTER TABLE "franchise_partners"
  ADD COLUMN "ledger_balance_in_paise" BIGINT NOT NULL DEFAULT 0;

-- ── 2. Backfill canonical debit/credit from the legacy signed model ─────────
-- Franchise balance perspective: credit raises, debit lowers what platform owes.
-- Procurement fee/cost are franchise liabilities (debit) even though their
-- franchise_earning is 0; everything else follows the sign of franchise_earning.
UPDATE "franchise_finance_ledger" SET
  credit_in_paise = CASE
    WHEN source_type IN ('PROCUREMENT_FEE','PROCUREMENT_COST') THEN 0
    WHEN franchise_earning >= 0 THEN round(franchise_earning * 100)::bigint
    ELSE 0 END,
  debit_in_paise = CASE
    WHEN source_type IN ('PROCUREMENT_FEE','PROCUREMENT_COST') THEN round(abs(computed_amount) * 100)::bigint
    WHEN franchise_earning < 0 THEN round(abs(franchise_earning) * 100)::bigint
    ELSE 0 END;

-- ── 3. Backfill per-entry running balance (chronological window sum) ────────
WITH running AS (
  SELECT id,
         SUM(credit_in_paise - debit_in_paise)
           OVER (PARTITION BY franchise_id ORDER BY created_at, id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS bal
  FROM "franchise_finance_ledger"
)
UPDATE "franchise_finance_ledger" l
SET balance_after_in_paise = running.bal
FROM running WHERE running.id = l.id;

-- ── 4. Backfill the franchise current balance (= sum of its entries) ────────
UPDATE "franchise_partners" p
SET ledger_balance_in_paise = COALESCE(
  (SELECT SUM(credit_in_paise - debit_in_paise)
   FROM "franchise_finance_ledger" WHERE franchise_id = p.id), 0);

-- ── 5. Backfill idempotency keys for event-sourced types (earliest wins) ────
-- Historical duplicates keep NULL (NULLs are distinct under the unique index);
-- future re-emits collide on the key and are deduped by the repository.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY source_type, source_id ORDER BY created_at, id) AS rn
  FROM "franchise_finance_ledger"
  WHERE source_type IN ('ONLINE_ORDER','POS_SALE','POS_SALE_REVERSAL','PROCUREMENT_FEE','PROCUREMENT_COST','RETURN_REVERSAL')
)
UPDATE "franchise_finance_ledger" l
SET idempotency_key = l.source_type || ':' || l.source_id
FROM ranked WHERE ranked.id = l.id AND ranked.rn = 1;

-- ── 6. Unique + indexes ─────────────────────────────────────────────────────
CREATE UNIQUE INDEX "franchise_finance_ledger_idempotency_key_key" ON "franchise_finance_ledger"("idempotency_key");
CREATE INDEX "franchise_finance_ledger_franchise_id_created_at_idx" ON "franchise_finance_ledger"("franchise_id","created_at");
CREATE INDEX "franchise_finance_ledger_franchise_id_source_type_created_at_idx" ON "franchise_finance_ledger"("franchise_id","source_type","created_at");
CREATE INDEX "franchise_finance_ledger_created_by_admin_id_created_at_idx" ON "franchise_finance_ledger"("created_by_admin_id","created_at");

-- ── 7. Status-history table (#14) ───────────────────────────────────────────
CREATE TABLE "franchise_ledger_status_history" (
  "id"              TEXT NOT NULL,
  "ledger_entry_id" TEXT NOT NULL,
  "from_status"     TEXT NOT NULL,
  "to_status"       TEXT NOT NULL,
  "actor_admin_id"  TEXT,
  "reason"          TEXT,
  "occurred_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_ledger_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "franchise_ledger_status_history_ledger_entry_id_idx" ON "franchise_ledger_status_history"("ledger_entry_id");
ALTER TABLE "franchise_ledger_status_history"
  ADD CONSTRAINT "franchise_ledger_status_history_ledger_entry_id_fkey"
  FOREIGN KEY ("ledger_entry_id") REFERENCES "franchise_finance_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
