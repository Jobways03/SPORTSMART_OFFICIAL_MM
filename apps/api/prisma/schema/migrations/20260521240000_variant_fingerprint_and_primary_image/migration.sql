-- Phase 41 (2026-05-21) — Variant integrity migration.
--
-- 1. ProductVariant.option_fingerprint
--    A deterministic hash of the sorted optionValueIds the variant
--    represents. Computed in VariantGeneratorService at create time.
--    The partial unique index below makes "two variants for the same
--    Red/Large combination on one product" physically impossible —
--    Postgres surfaces a unique violation that the controller maps to
--    409 ConflictException.
--
--    Pre-Phase-41 the schema only carried @@unique([variantId,
--    optionValueId]) on the join table, which prevents the SAME variant
--    from having two of the same option value but does NOT prevent two
--    distinct variants from holding the same combination. Variant
--    generation deduped by Cartesian product (safe), but manual POST
--    /variants followed by subsequent option-value attaches could
--    create the conflict.
--
-- 2. ProductVariantImage.is_primary + partial unique
--    Mirrors the Phase 29 pattern on product_images. Storefront /
--    cart-thumbnail logic now picks the variant hero by isPrimary
--    instead of "sortOrder = 0" which is fragile under reorder.
--
-- 3. (product_id, status) composite index
--    Covers the "active variants for this product" lookup used by
--    storefront PDP, cart validation, and the new cart status guard
--    (Gap #12 fix).

-- 1a. Add the option_fingerprint column (nullable for migration safety;
--     the application backfills on next variant write).
ALTER TABLE "product_variants"
  ADD COLUMN "option_fingerprint" TEXT;

-- 1b. Partial unique on the fingerprint, restricted to live rows.
--     Soft-deleted variants are excluded so a regeneration after
--     soft-delete can re-use the same combination without a conflict.
CREATE UNIQUE INDEX "product_variants_option_fingerprint_unique"
  ON "product_variants" ("product_id", "option_fingerprint")
  WHERE "option_fingerprint" IS NOT NULL AND "is_deleted" = false;

-- 2a. Add is_primary on ProductVariantImage.
ALTER TABLE "product_variant_images"
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- 2b. Partial unique on (variant_id) WHERE is_primary = true.
--     One hero per variant. Multer upload controller catches P2002
--     and retries with is_primary = false (same pattern as
--     product_images_one_primary_idx in 20260521160000).
CREATE UNIQUE INDEX "product_variant_images_one_primary_idx"
  ON "product_variant_images" ("variant_id")
  WHERE "is_primary" = true;

-- 2c. Backfill: for variants that have at least one image, mark the
--     sortOrder=0 image as the hero so existing data follows the new
--     contract.
UPDATE "product_variant_images" SET "is_primary" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("variant_id") "id"
  FROM "product_variant_images"
  ORDER BY "variant_id", "sort_order" ASC, "created_at" ASC
);

-- 3. Composite (product_id, status) index.
CREATE INDEX "product_variants_product_id_status_idx"
  ON "product_variants" ("product_id", "status");
