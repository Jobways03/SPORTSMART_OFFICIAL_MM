-- Phase 202 (#13) — wishlist add-time price snapshot.
--
-- Captures the unit price (integer paise, BigInt) the customer saw
-- when they saved the item, so the storefront can later surface a
-- "price dropped since you saved this" hint without a price-history
-- join. Nullable:
--   * legacy rows predate the column (no backfill — there is no
--     reliable historical "price at the moment of save" to reconstruct);
--   * an abstract "any variant" save on a variant-priced product has
--     no single price to snapshot.
--
-- Because the column is nullable with no default, this is a metadata-
-- only ALTER (no table rewrite, no backfill step required).

ALTER TABLE "wishlist_items"
  ADD COLUMN "unit_price_in_paise_at_add" BIGINT;
