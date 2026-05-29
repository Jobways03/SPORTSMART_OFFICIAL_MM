-- Phase 60 (2026-05-22) — auto-repair stale-mapping flow hardening.
--
-- The auto-repair path (admin reads /admin/products/:id/seller-mappings,
-- system fans the stale product-level mapping out into per-variant
-- mappings) needs two new columns so the migration leaves a queryable
-- trail (audit Gap #12):
--   * migratedFromMappingId — points back to the soft-deleted source
--     row so "show every mapping that inherited from stale X" is a
--     single indexed lookup.
--   * migratedAt — the wall-clock when the fan-out happened.
--
-- Two composite indexes:
--   * (productId, variantId, deletedAt) — backs the new hot-path
--     pre-check that skips the heavy fan-out logic on every admin
--     read when there's nothing stale to repair.
--   * (migrated_from_mapping_id) — single-column index for the
--     forensic lookup above.
ALTER TABLE "seller_product_mappings"
  ADD COLUMN "migrated_from_mapping_id" TEXT,
  ADD COLUMN "migrated_at" TIMESTAMP(3);

CREATE INDEX "seller_product_mappings_product_id_variant_id_deleted_at_idx"
  ON "seller_product_mappings"("product_id", "variant_id", "deleted_at");

CREATE INDEX "seller_product_mappings_migrated_from_mapping_id_idx"
  ON "seller_product_mappings"("migrated_from_mapping_id");
