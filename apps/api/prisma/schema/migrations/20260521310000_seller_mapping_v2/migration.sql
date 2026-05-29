-- Phase 51 (2026-05-21) — seller mapping soft-delete.

ALTER TABLE "seller_product_mappings"
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "seller_product_mappings_deleted_at_idx"
  ON "seller_product_mappings" ("deleted_at");
