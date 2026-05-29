-- Phase 61 (2026-05-22) — cart_items hardening.
--
-- 1) Per-row timestamps (audit Gap #13) — backfilled to NOW() so
--    a populated catalog doesn't lose its history.
ALTER TABLE "cart_items"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2) Add-time price snapshot (audit Gap #22). Nullable so the
--    backfill can populate it from the current live price; new
--    rows always write it on create.
ALTER TABLE "cart_items"
  ADD COLUMN "unit_price_at_add_in_paise" BIGINT;

-- Backfill snapshot from variant price first, falling back to base
-- product price. We bigint-promote the decimal so paise math stays
-- exact.
UPDATE "cart_items" ci
SET "unit_price_at_add_in_paise" = (
  COALESCE(
    (
      SELECT ROUND(pv."price" * 100)::bigint
      FROM "product_variants" pv
      WHERE pv."id" = ci."variant_id"
    ),
    (
      SELECT ROUND(p."base_price" * 100)::bigint
      FROM "products" p
      WHERE p."id" = ci."product_id"
    ),
    0::bigint
  )
)
WHERE ci."unit_price_at_add_in_paise" IS NULL;

-- 3) Switch variant FK from SetNull to Restrict (audit Gap #10).
--    Pre-Phase-61 hard-deleting a variant silently dropped the
--    variantId on every cart line referencing it, falling back to
--    the base-product price. Restrict blocks the delete; the
--    catalog soft-delete path already calls countActiveItemsForVariant
--    so legitimate admin actions are unaffected.
ALTER TABLE "cart_items"
  DROP CONSTRAINT IF EXISTS "cart_items_variant_id_fkey";
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Partial unique indexes for the variantId NULL semantics (audit
--    Gap #17). The Prisma-generated `@@unique([cartId, productId,
--    variantId])` does NOT dedupe rows where variantId IS NULL
--    because Postgres treats NULL as distinct in compound unique
--    indexes. The FOR UPDATE primitive serialises adds at the
--    application level; these partial indexes are defence-in-depth.
DROP INDEX IF EXISTS "cart_items_cart_id_product_id_variant_id_key";
CREATE UNIQUE INDEX "cart_items_uniq_with_variant"
  ON "cart_items" ("cart_id", "product_id", "variant_id")
  WHERE "variant_id" IS NOT NULL;
CREATE UNIQUE INDEX "cart_items_uniq_no_variant"
  ON "cart_items" ("cart_id", "product_id")
  WHERE "variant_id" IS NULL;

-- 5) updatedAt index for the abandonment-sweep cron (audit Gap #12).
CREATE INDEX "cart_items_updated_at_idx"
  ON "cart_items"("updated_at");
