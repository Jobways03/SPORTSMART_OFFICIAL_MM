-- Per-slot price treatment ("₹999" + "Onwards") so admin-added tiles
-- can carry price overlays without a code change.

ALTER TABLE "storefront_content_blocks"
  ADD COLUMN "price" TEXT,
  ADD COLUMN "price_caption" TEXT;
