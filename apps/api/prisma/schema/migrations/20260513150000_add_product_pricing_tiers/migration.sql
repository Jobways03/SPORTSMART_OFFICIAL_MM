-- Sprint 4 Story 3.5 — Product pricing tiers (display-only at v1).
--
-- Each row is a rung on the quantity ladder for a product (optionally
-- scoped to a specific variant). PDP renders the ladder and the
-- "current vs. next threshold" hint; cart pricing is unchanged at v1
-- so this lands as a zero-blast-radius schema add.
--
-- Variant id is nullable on purpose: a tier can apply to "any variant
-- of this product" (variant_id NULL) or to a specific variant. ANSI
-- NULLs-distinct behaviour lets both shapes coexist for the same
-- product.

CREATE TABLE "product_pricing_tiers" (
  "id"               TEXT NOT NULL,
  "product_id"       TEXT NOT NULL,
  "variant_id"       TEXT,
  "min_quantity"     INTEGER NOT NULL,
  "discount_percent" DECIMAL(5,2) NOT NULL,
  "display_label"    TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- One tier per (product, variant, minQuantity). NULL variant treated
-- as distinct per ANSI SQL — see the prisma model comment.
CREATE UNIQUE INDEX "product_pricing_tiers_product_id_variant_id_min_quantity_key"
  ON "product_pricing_tiers"("product_id", "variant_id", "min_quantity");

CREATE INDEX "product_pricing_tiers_product_id_idx"
  ON "product_pricing_tiers"("product_id");

-- The hot read path on PDP only wants active tiers for one product,
-- so the (product_id, is_active) compound index lets Postgres skip
-- inactive rows entirely.
CREATE INDEX "product_pricing_tiers_product_id_is_active_idx"
  ON "product_pricing_tiers"("product_id", "is_active");

ALTER TABLE "product_pricing_tiers"
  ADD CONSTRAINT "product_pricing_tiers_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Guardrails — percent must stay in [0, 100], quantity must be > 0.
-- Enforced at the DB layer so any future writer (script, seed) can't
-- bypass the service-layer check.
ALTER TABLE "product_pricing_tiers"
  ADD CONSTRAINT "product_pricing_tiers_discount_percent_range"
  CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100);

ALTER TABLE "product_pricing_tiers"
  ADD CONSTRAINT "product_pricing_tiers_min_quantity_positive"
  CHECK ("min_quantity" > 0);
