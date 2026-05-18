-- Phase 4 follow-up (2026-05-16) — per-product SKU uniqueness on
-- product_variants. The application layer already enforces this
-- inside PrismaVariantRepository (create + update), but a DB-level
-- partial UNIQUE constraint closes the race window where two
-- concurrent creates both pass the app check then both insert.
--
-- ─── Pre-flight check (RUN THIS FIRST) ───────────────────────────
-- Surfaces any existing (productId, sku) pairs that violate the new
-- constraint. Output empty = safe to deploy. Output non-empty = fix
-- the duplicates BEFORE applying this migration.
--
--   SELECT product_id, sku, COUNT(*) AS dup_count
--     FROM product_variants
--    WHERE is_deleted = FALSE
--      AND sku IS NOT NULL
--    GROUP BY product_id, sku
--   HAVING COUNT(*) > 1
--    ORDER BY dup_count DESC;
--
-- For each duplicate row, the team should either rename the SKU on
-- one of the variants OR soft-delete one of them (is_deleted=TRUE).
-- ─────────────────────────────────────────────────────────────────
--
-- Implementation note: Postgres treats NULL as distinct in UNIQUE
-- constraints, so variants without a SKU don't collide with each
-- other. We use a PARTIAL UNIQUE INDEX restricted to `is_deleted =
-- FALSE` so soft-deleted rows from a previous lifecycle don't block
-- a new variant from reclaiming the same SKU.
--
-- Prisma emits the constraint name `product_variants_product_id_sku_key`
-- when @@unique is added with default naming. We override to the
-- documented name used in the @@unique declaration so the schema +
-- migration agree.

CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_product_sku_unique"
  ON "product_variants" ("product_id", "sku")
  WHERE "is_deleted" = FALSE
    AND "sku" IS NOT NULL;
