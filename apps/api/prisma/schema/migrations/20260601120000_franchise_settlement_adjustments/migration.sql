-- Phase 177 (Per-Franchise Accounts audit #4 / audit #145 gap) — itemized
-- franchise settlement adjustments. Reuses the existing
-- "SettlementAdjustmentType" / "SettlementAdjustmentStatus" enums (created for
-- the seller SettlementAdjustment).

CREATE TABLE IF NOT EXISTS "franchise_settlement_adjustments" (
  "id"                  TEXT NOT NULL,
  "settlement_id"       TEXT NOT NULL,
  "franchise_id"        TEXT NOT NULL,
  "amount"              DECIMAL(12,2) NOT NULL,
  "amount_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "adjustment_type"     "SettlementAdjustmentType" NOT NULL DEFAULT 'MANUAL_CORRECTION',
  "status"              "SettlementAdjustmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"               TEXT,
  "created_by_admin_id" TEXT,
  "voided_by_admin_id"  TEXT,
  "voided_at"           TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_settlement_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fsa_settlement_idx"
  ON "franchise_settlement_adjustments" ("settlement_id");
CREATE INDEX IF NOT EXISTS "fsa_franchise_status_idx"
  ON "franchise_settlement_adjustments" ("franchise_id", "status");

ALTER TABLE "franchise_settlement_adjustments"
  ADD CONSTRAINT "fsa_settlement_fkey"
  FOREIGN KEY ("settlement_id")
  REFERENCES "franchise_settlements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
