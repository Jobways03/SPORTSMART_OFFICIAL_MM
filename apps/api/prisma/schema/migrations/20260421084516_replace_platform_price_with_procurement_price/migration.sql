-- Remove Product/Variant.platform_price (catalog column, customer-
-- facing price duplicate — obsolete; customer now always sees
-- price/basePrice) and replace with procurement_price (platform-
-- wide default landed cost for the franchise procurement flow).
--
-- costPrice stays as a display-only field per product policy. The
-- procurement flow switches from reading costPrice to reading
-- procurement_price in a separate application-layer change.
--
-- Data carry-forward: existing costPrice values are copied into
-- procurement_price so the pre-existing admin-entered cost defaults
-- keep working after the refactor. Previously-set platformPrice
-- values are NOT copied — customer-facing pricing consolidates on
-- price/basePrice, which already contain the seller's price.

ALTER TABLE "products" ADD COLUMN "procurement_price" DECIMAL(10,2);
ALTER TABLE "product_variants" ADD COLUMN "procurement_price" DECIMAL(10,2);

-- Carry costPrice → procurement_price for existing rows.
UPDATE "products" SET "procurement_price" = "cost_price" WHERE "cost_price" IS NOT NULL;
UPDATE "product_variants" SET "procurement_price" = "cost_price" WHERE "cost_price" IS NOT NULL;

ALTER TABLE "products" DROP COLUMN "platform_price";
ALTER TABLE "product_variants" DROP COLUMN "platform_price";
