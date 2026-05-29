-- Phase 56 (2026-05-22) — seller_product_mappings approval lifecycle
-- + audit columns.

ALTER TABLE "seller_product_mappings"
  ADD COLUMN "approved_by" TEXT,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "rejected_by" TEXT,
  ADD COLUMN "rejected_at" TIMESTAMP(3),
  ADD COLUMN "rejection_reason" TEXT,
  ADD COLUMN "stopped_by" TEXT,
  ADD COLUMN "stopped_at" TIMESTAMP(3),
  ALTER COLUMN "is_active" SET DEFAULT FALSE;
