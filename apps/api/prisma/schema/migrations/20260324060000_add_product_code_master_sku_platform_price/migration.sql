-- AlterTable: Add productCode and platformPrice to products
ALTER TABLE "products" ADD COLUMN "product_code" TEXT;
ALTER TABLE "products" ADD COLUMN "platform_price" DECIMAL(10,2);

-- AlterTable: Add masterSku and platformPrice to product_variants
ALTER TABLE "product_variants" ADD COLUMN "master_sku" TEXT;
ALTER TABLE "product_variants" ADD COLUMN "platform_price" DECIMAL(10,2);

-- CreateTable: ProductCodeSequence
CREATE TABLE "product_code_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_code_sequence_pkey" PRIMARY KEY ("id")
);

-- Seed sequence row
INSERT INTO "product_code_sequence" ("id", "last_number") VALUES (1, 0) ON CONFLICT DO NOTHING;

-- Generate product codes for existing products
DO $$
DECLARE
    r RECORD;
    seq_num INTEGER := 0;
BEGIN
    FOR r IN SELECT id FROM products ORDER BY created_at ASC LOOP
        seq_num := seq_num + 1;
        UPDATE products SET product_code = 'PRD-' || LPAD(seq_num::TEXT, 6, '0') WHERE id = r.id;
    END LOOP;
    UPDATE product_code_sequence SET last_number = seq_num WHERE id = 1;
END $$;

-- Generate master SKUs for existing variants
DO $$
DECLARE
    v RECORD;
    prod_code TEXT;
    sku_suffix TEXT;
BEGIN
    FOR v IN SELECT pv.id, pv.product_id, p.product_code
             FROM product_variants pv
             JOIN products p ON pv.product_id = p.id
             ORDER BY p.created_at ASC, pv.sort_order ASC LOOP
        -- Build SKU from option values
        SELECT string_agg(UPPER(LEFT(ov.value, 3)), '-' ORDER BY od.name ASC)
        INTO sku_suffix
        FROM product_variant_option_values pvov
        JOIN option_values ov ON pvov.option_value_id = ov.id
        JOIN option_definitions od ON ov.option_definition_id = od.id
        WHERE pvov.variant_id = v.id;

        IF sku_suffix IS NOT NULL THEN
            UPDATE product_variants SET master_sku = v.product_code || '-' || sku_suffix WHERE id = v.id;
        ELSE
            UPDATE product_variants SET master_sku = v.product_code || '-' || UPPER(LEFT(COALESCE(v.id, ''), 6)) WHERE id = v.id;
        END IF;
    END LOOP;
END $$;

-- Now add unique constraints (safe because we populated all rows above)
CREATE UNIQUE INDEX "products_product_code_key" ON "products"("product_code");
CREATE UNIQUE INDEX "product_variants_master_sku_key" ON "product_variants"("master_sku");

-- Add index for faster lookups
CREATE INDEX "products_product_code_idx" ON "products"("product_code");
CREATE INDEX "product_variants_master_sku_idx" ON "product_variants"("master_sku");
