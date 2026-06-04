-- Phase 178 — Outstanding Payables (SLA / aging) audit remediation.
--
-- Adds the SLA / aging / hold / partial-pay primitives the flow needs:
--   #1  payout_due_by on seller + franchise settlements (and the cycle).
--   #4  ON_HOLD / PARTIALLY_PAID statuses + hold_reason / frozen_at /
--       frozen_by_admin_id provenance.
--   #12 paid_amount_in_paise for partial bank disbursement.
-- The backfill UPDATEs reference only EXISTING enum values, so the new enum
-- values added above are never used in this transaction (Postgres forbids that).

-- ── #4 new statuses ──────────────────────────────────────────────────────────
ALTER TYPE "SellerSettlementStatus"    ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "SellerSettlementStatus"    ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';
ALTER TYPE "FranchiseSettlementStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "FranchiseSettlementStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';

-- ── #1/#4/#12 columns ────────────────────────────────────────────────────────
ALTER TABLE "seller_settlements"
  ADD COLUMN IF NOT EXISTS "payout_due_by"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "hold_reason"          TEXT,
  ADD COLUMN IF NOT EXISTS "frozen_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "frozen_by_admin_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "paid_amount_in_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "franchise_settlements"
  ADD COLUMN IF NOT EXISTS "payout_due_by"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "hold_reason"          TEXT,
  ADD COLUMN IF NOT EXISTS "frozen_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "frozen_by_admin_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "paid_amount_in_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "settlement_cycles"
  ADD COLUMN IF NOT EXISTS "payout_due_by" TIMESTAMP(3);

-- ── #1 aging indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "seller_settlements_status_payout_due_by_idx"
  ON "seller_settlements" ("status", "payout_due_by");
CREATE INDEX IF NOT EXISTS "franchise_settlements_status_payout_due_by_idx"
  ON "franchise_settlements" ("status", "payout_due_by");

-- ── Backfill (default SLA = 7 calendar days; the service computes business-day
--    SLA for NEW settlements going forward). Only EXISTING enum values used. ──
UPDATE "settlement_cycles"
   SET "payout_due_by" = "period_end" + INTERVAL '7 days'
 WHERE "payout_due_by" IS NULL;

UPDATE "seller_settlements"
   SET "payout_due_by" = "created_at" + INTERVAL '7 days'
 WHERE "payout_due_by" IS NULL AND "status" IN ('PENDING', 'APPROVED', 'FAILED');

UPDATE "franchise_settlements"
   SET "payout_due_by" = "created_at" + INTERVAL '7 days'
 WHERE "payout_due_by" IS NULL AND "status" IN ('PENDING', 'APPROVED', 'FAILED');
