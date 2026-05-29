-- Phase 54 (2026-05-21) — low_stock_alerts hardening.

CREATE TYPE "LowStockAlertStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DISMISSED');

ALTER TABLE "low_stock_alerts"
  ADD COLUMN "resource_type" TEXT NOT NULL DEFAULT 'SELLER_MAPPING',
  ADD COLUMN "franchise_stock_id" TEXT,
  ADD COLUMN "franchise_id" TEXT,
  ADD COLUMN "variant_id" TEXT,
  ADD COLUMN "available_stock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reserved_stock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "LowStockAlertStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "dismissed_at" TIMESTAMP(3),
  ADD COLUMN "dismissed_by" TEXT,
  ADD COLUMN "dismiss_until" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "seller_product_mapping_id" DROP NOT NULL,
  ALTER COLUMN "seller_id" DROP NOT NULL;

-- Lock-step backfill: any existing rows are SELLER_MAPPING type;
-- their available_stock + reserved_stock default to 0 which the next
-- cron tick will recompute.
UPDATE "low_stock_alerts"
  SET "resource_type" = 'SELLER_MAPPING'
  WHERE "resource_type" IS NULL;

-- Existing resolved rows → RESOLVED; everything else stays ACTIVE.
UPDATE "low_stock_alerts"
  SET "status" = 'RESOLVED'
  WHERE "resolved_at" IS NOT NULL;

CREATE UNIQUE INDEX "low_stock_alerts_franchise_stock_id_key"
  ON "low_stock_alerts" ("franchise_stock_id");
CREATE INDEX "low_stock_alerts_status_created_at_idx"
  ON "low_stock_alerts" ("status", "created_at");
CREATE INDEX "low_stock_alerts_seller_id_status_idx"
  ON "low_stock_alerts" ("seller_id", "status");
CREATE INDEX "low_stock_alerts_franchise_id_status_idx"
  ON "low_stock_alerts" ("franchise_id", "status");
CREATE INDEX "low_stock_alerts_product_id_variant_id_idx"
  ON "low_stock_alerts" ("product_id", "variant_id");
