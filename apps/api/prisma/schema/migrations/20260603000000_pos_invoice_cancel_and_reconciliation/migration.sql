-- Phase 238/239/242 — POS void/return tax-invoice cancellation + the bounded
-- cash-vs-bank reconciliation core. Not yet applied (branch sd001); deploy with
-- `prisma migrate deploy`.

-- ── #238/#239 — mark the §31 invoice CANCELLED on void/return ────────────────
-- (ADD VALUE only; transaction-safe on PG 12+.)
ALTER TYPE "PosTaxInvoiceStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ── #242 — reconciliation status enum + table ───────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PosReconciliationStatus" AS ENUM ('SUBMITTED','MATCHED','VARIANCE','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "franchise_pos_reconciliations" (
  "id"                     TEXT NOT NULL,
  "franchise_id"           TEXT NOT NULL,
  "business_date"          DATE NOT NULL,
  "expected_cash_in_paise" BIGINT NOT NULL,
  "actual_cash_in_paise"   BIGINT NOT NULL,
  "bank_deposit_in_paise"  BIGINT NOT NULL DEFAULT 0,
  "bank_deposit_reference" VARCHAR(64),
  "variance_in_paise"      BIGINT NOT NULL,
  "expected_snapshot_json" JSONB,
  "status"                 "PosReconciliationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "notes"                  TEXT,
  "submitted_by_staff_id"  TEXT,
  "submitted_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_admin_id"   TEXT,
  "reviewed_at"            TIMESTAMP(3),
  "resolution_reason"      TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "franchise_pos_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "franchise_pos_reconciliations_franchise_id_business_date_key"
  ON "franchise_pos_reconciliations" ("franchise_id", "business_date");
CREATE INDEX IF NOT EXISTS "franchise_pos_reconciliations_franchise_id_business_date_idx"
  ON "franchise_pos_reconciliations" ("franchise_id", "business_date");
CREATE INDEX IF NOT EXISTS "franchise_pos_reconciliations_status_idx"
  ON "franchise_pos_reconciliations" ("status");
