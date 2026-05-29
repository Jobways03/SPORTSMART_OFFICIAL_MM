-- Phase 53 (2026-05-21) — stock_movements multi-resource extension.

ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'DAMAGE';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'LOSS';
ALTER TYPE "StockMovementKind" ADD VALUE IF NOT EXISTS 'AUDIT_CORRECTION';

ALTER TABLE "stock_movements"
  ADD COLUMN "resource_type" TEXT NOT NULL DEFAULT 'SELLER_MAPPING',
  ADD COLUMN "resource_id" TEXT NOT NULL DEFAULT '',
  ALTER COLUMN "mapping_id" DROP NOT NULL;

-- Backfill resource_id from mapping_id for existing rows so the new
-- discriminator index has usable values immediately.
UPDATE "stock_movements"
  SET "resource_id" = "mapping_id"
  WHERE "resource_id" = '' AND "mapping_id" IS NOT NULL;

CREATE INDEX "stock_movements_resource_type_resource_id_created_at_idx"
  ON "stock_movements" ("resource_type", "resource_id", "created_at" DESC);
