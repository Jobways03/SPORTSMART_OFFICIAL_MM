-- Phase 44 (2026-05-21) — Pricing Tier v2.
--
-- Pre-Phase-44 the ProductPricingTier model only carried
-- discount_percent + min_quantity (display-only ladder). v2 adds:
--   * fixed_unit_price       — absolute override mode
--   * max_quantity           — closed-range tier brackets
--   * start_at / end_at      — scheduled tier windows
--   * snapshot columns on cart_items + order_items so refunds,
--     disputes, and commission re-computation can prove the
--     discount applied to a given line
--
-- discount_percent is also widened to NULL-able since each tier now
-- has exactly one of (discount_percent, fixed_unit_price). The CHECK
-- below enforces the invariant.

-- ─── 1. ProductPricingTier — new columns + CHECKs ──────────────

-- 1a. Drop the NOT-NULL on discount_percent so the new mutual-
--     exclusion CHECK can govern. Existing rows keep their value.
ALTER TABLE "product_pricing_tiers"
  ALTER COLUMN "discount_percent" DROP NOT NULL;

ALTER TABLE "product_pricing_tiers"
  ADD COLUMN "fixed_unit_price" DECIMAL(10, 2),
  ADD COLUMN "max_quantity" INTEGER,
  ADD COLUMN "start_at" TIMESTAMP(3),
  ADD COLUMN "end_at" TIMESTAMP(3);

-- 1b. Mutual exclusion of pricing mode. Exactly one of the two
--     pricing columns must be set. Existing rows have
--     discount_percent set, so they satisfy this trivially.
ALTER TABLE "product_pricing_tiers"
  ADD CONSTRAINT "product_pricing_tiers_pricing_mode_check"
  CHECK (
    (discount_percent IS NOT NULL AND fixed_unit_price IS NULL)
    OR (discount_percent IS NULL AND fixed_unit_price IS NOT NULL)
  );

-- 1c. max_quantity must be >= min_quantity when present.
ALTER TABLE "product_pricing_tiers"
  ADD CONSTRAINT "product_pricing_tiers_max_qty_check"
  CHECK (max_quantity IS NULL OR max_quantity >= min_quantity);

-- 1d. end_at must be after start_at when both are present.
ALTER TABLE "product_pricing_tiers"
  ADD CONSTRAINT "product_pricing_tiers_window_check"
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at);

-- 1e. Composite index for the resolver's hot path.
CREATE INDEX "product_pricing_tiers_product_active_variant_idx"
  ON "product_pricing_tiers" ("product_id", "is_active", "variant_id");

-- ─── 2. CartItem snapshot columns ──────────────────────────────

ALTER TABLE "cart_items"
  ADD COLUMN "applied_pricing_tier_id" TEXT,
  ADD COLUMN "applied_discount_percent" DECIMAL(5, 2),
  ADD COLUMN "applied_fixed_unit_price" DECIMAL(10, 2),
  ADD COLUMN "applied_list_unit_price" DECIMAL(10, 2);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_applied_pricing_tier_id_fkey"
  FOREIGN KEY ("applied_pricing_tier_id")
  REFERENCES "product_pricing_tiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cart_items_applied_pricing_tier_id_idx"
  ON "cart_items" ("applied_pricing_tier_id");

-- ─── 3. OrderItem snapshot columns ─────────────────────────────

ALTER TABLE "order_items"
  ADD COLUMN "applied_pricing_tier_id" TEXT,
  ADD COLUMN "applied_discount_percent" DECIMAL(5, 2),
  ADD COLUMN "applied_fixed_unit_price" DECIMAL(10, 2),
  ADD COLUMN "applied_list_unit_price" DECIMAL(10, 2);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_applied_pricing_tier_id_fkey"
  FOREIGN KEY ("applied_pricing_tier_id")
  REFERENCES "product_pricing_tiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_items_applied_pricing_tier_id_idx"
  ON "order_items" ("applied_pricing_tier_id");
