-- CreateTable
CREATE TABLE "seller_product_mappings" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "seller_internal_sku" TEXT,
    "settlement_price" DECIMAL(10,2),
    "procurement_cost" DECIMAL(10,2),
    "pickup_address" TEXT,
    "pickup_pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "dispatch_sla" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "operational_priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_product_mappings_seller_id_idx" ON "seller_product_mappings"("seller_id");
CREATE INDEX "seller_product_mappings_product_id_idx" ON "seller_product_mappings"("product_id");
CREATE INDEX "seller_product_mappings_variant_id_idx" ON "seller_product_mappings"("variant_id");
CREATE INDEX "seller_product_mappings_pickup_pincode_idx" ON "seller_product_mappings"("pickup_pincode");
CREATE INDEX "seller_product_mappings_is_active_idx" ON "seller_product_mappings"("is_active");

-- UniqueConstraint
CREATE UNIQUE INDEX "seller_product_mappings_seller_id_product_id_variant_id_key" ON "seller_product_mappings"("seller_id", "product_id", "variant_id");

-- AddForeignKey
ALTER TABLE "seller_product_mappings" ADD CONSTRAINT "seller_product_mappings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_product_mappings" ADD CONSTRAINT "seller_product_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_product_mappings" ADD CONSTRAINT "seller_product_mappings_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
