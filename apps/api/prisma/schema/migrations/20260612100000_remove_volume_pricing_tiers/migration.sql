-- 2026-06-12 — Volume pricing tiers removed (product decision).
--
-- Drops the entire pricing-tier feature introduced by
-- 20260513150000_add_product_pricing_tiers (Story 3.5) and expanded by
-- 20260521250000_pricing_tier_v2 (Phase 44):
--   * the product_pricing_tiers table (with its indexes, CHECKs, FK)
--   * the applied_* snapshot columns + FKs on cart_items / order_items
--
-- Historical OrderItem rows lose their tier-snapshot forensics; the
-- Decimal/paise price columns (what the customer actually paid) are
-- untouched, so order, refund, tax, and settlement math is unaffected.
-- Cart rows are ephemeral — no backfill needed.

-- ─── 1. cart_items — snapshot columns ──────────────────────────────

ALTER TABLE "cart_items"
  DROP CONSTRAINT IF EXISTS "cart_items_applied_pricing_tier_id_fkey";

DROP INDEX IF EXISTS "cart_items_applied_pricing_tier_id_idx";

ALTER TABLE "cart_items"
  DROP COLUMN IF EXISTS "applied_pricing_tier_id",
  DROP COLUMN IF EXISTS "applied_discount_percent",
  DROP COLUMN IF EXISTS "applied_fixed_unit_price",
  DROP COLUMN IF EXISTS "applied_list_unit_price";

-- ─── 2. order_items — snapshot columns ─────────────────────────────

ALTER TABLE "order_items"
  DROP CONSTRAINT IF EXISTS "order_items_applied_pricing_tier_id_fkey";

DROP INDEX IF EXISTS "order_items_applied_pricing_tier_id_idx";

ALTER TABLE "order_items"
  DROP COLUMN IF EXISTS "applied_pricing_tier_id",
  DROP COLUMN IF EXISTS "applied_discount_percent",
  DROP COLUMN IF EXISTS "applied_fixed_unit_price",
  DROP COLUMN IF EXISTS "applied_list_unit_price";

-- ─── 3. product_pricing_tiers — the table itself ───────────────────
-- Indexes, CHECK constraints, and the products FK go with the table.

DROP TABLE IF EXISTS "product_pricing_tiers";

-- ─── 4. Backfill — neutralise poisoned drift snapshots ─────────────
-- The tier-era addItem passed listUnitPrice=0 into the resolver, which
-- short-circuited and returned 0 — so every cart line created while
-- the tier code was live persisted unit_price_at_add_in_paise = 0.
-- Against the live list price the Phase 61 priceChanged flag would
-- false-fire on those rows forever. NULL disables the flag (the cart
-- service treats a missing snapshot as "no drift signal").

UPDATE "cart_items"
SET "unit_price_at_add_in_paise" = NULL
WHERE "unit_price_at_add_in_paise" = 0;
