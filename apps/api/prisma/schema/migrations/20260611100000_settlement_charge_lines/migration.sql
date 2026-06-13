-- Phase 251 — wire dynamic settlement charge rules into the settlement cycle.
-- Per-settlement frozen charge breakup + denorm total + an "applied" flag so
-- the net-payout switch only affects cycles created after this change (old
-- cycles keep the legacy tcs+tds+commissionGst formula). Hand-authored
-- (dev DB drift) — applied via direct apply / `migrate deploy`.

ALTER TABLE "seller_settlements"
  ADD COLUMN "dynamic_charge_total_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "charge_rules_applied" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "settlement_charge_lines" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "rule_name" TEXT NOT NULL,
    "base_type" TEXT NOT NULL,
    "base_rule_id" TEXT,
    "base_amount_in_paise" BIGINT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "amount_in_paise" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_charge_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "settlement_charge_lines_settlement_id_idx" ON "settlement_charge_lines"("settlement_id");

ALTER TABLE "settlement_charge_lines"
  ADD CONSTRAINT "settlement_charge_lines_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "seller_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
