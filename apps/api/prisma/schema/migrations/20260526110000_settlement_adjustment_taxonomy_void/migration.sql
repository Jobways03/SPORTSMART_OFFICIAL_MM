-- Phase 147 — settlement adjustment taxonomy + void lifecycle + provenance,
-- and an immutable "approved gross" snapshot on seller settlements.

CREATE TYPE "SettlementAdjustmentType" AS ENUM (
  'COURIER_PENALTY', 'SLA_FINE', 'GOODWILL', 'MANUAL_CORRECTION', 'OTHER'
);
CREATE TYPE "SettlementAdjustmentStatus" AS ENUM ('ACTIVE', 'VOIDED');

ALTER TABLE "settlement_adjustments"
  ADD COLUMN "adjustment_type" "SettlementAdjustmentType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "status" "SettlementAdjustmentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reference_document_url" TEXT,
  ADD COLUMN "voided_by_admin_id" TEXT,
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "void_reason" TEXT;

ALTER TABLE "settlement_adjustments"
  ADD CONSTRAINT "settlement_adjustments_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlement_adjustments"
  ADD CONSTRAINT "settlement_adjustments_voided_by_admin_id_fkey"
  FOREIGN KEY ("voided_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "settlement_adjustments_settlement_id_created_at_idx"
  ON "settlement_adjustments"("settlement_id", "created_at");
CREATE INDEX "settlement_adjustments_adjustment_type_idx"
  ON "settlement_adjustments"("adjustment_type");
CREATE INDEX "settlement_adjustments_status_idx"
  ON "settlement_adjustments"("status");

-- Immutable approved-gross snapshot. Backfill existing rows from the current
-- total (best available — pre-Phase-147 rows already folded adjustments in;
-- from here on the column is set once at cycle creation and never mutated).
ALTER TABLE "seller_settlements"
  ADD COLUMN "approved_settlement_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "approved_settlement_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "seller_settlements"
  SET "approved_settlement_amount" = "total_settlement_amount",
      "approved_settlement_amount_in_paise" = "total_settlement_amount_in_paise";
