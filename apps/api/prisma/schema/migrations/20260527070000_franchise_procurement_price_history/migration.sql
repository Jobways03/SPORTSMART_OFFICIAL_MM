-- Phase 159l (2026-05-27) — Per-franchise procurement-pricing hardening.
--
-- Adds (1) last-modifier + optimistic-concurrency version to the override
-- table, and (2) an append-only price-change history table so "who set this
-- cost / when / why" survives even a row DELETE (audit #4/#8/#13/#14).

ALTER TABLE "franchise_procurement_prices"
  ADD COLUMN IF NOT EXISTS "updated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "franchise_procurement_price_history" (
  "id" TEXT NOT NULL,
  "franchise_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_id" TEXT,
  "action" TEXT NOT NULL,
  "old_landed_unit_cost" DECIMAL(10,2),
  "new_landed_unit_cost" DECIMAL(10,2),
  "change_reason" TEXT,
  "changed_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_procurement_price_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_procurement_price_history_lookup_idx"
  ON "franchise_procurement_price_history" ("franchise_id", "product_id", "variant_id", "created_at");
ALTER TABLE "franchise_procurement_price_history"
  ADD CONSTRAINT "franchise_procurement_price_history_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
