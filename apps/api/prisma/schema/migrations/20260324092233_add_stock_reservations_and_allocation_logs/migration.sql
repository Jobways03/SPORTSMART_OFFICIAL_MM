-- DropIndex
DROP INDEX "product_variants_master_sku_idx";

-- DropIndex
DROP INDEX "products_product_code_idx";

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "mapping_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "order_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_logs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "customer_pincode" TEXT NOT NULL,
    "allocated_seller_id" TEXT,
    "allocated_mapping_id" TEXT,
    "allocation_reason" TEXT,
    "distanceKm" DECIMAL(10,2),
    "score" DECIMAL(10,4),
    "is_reallocated" BOOLEAN NOT NULL DEFAULT false,
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_mapping_id_idx" ON "stock_reservations"("mapping_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_idx" ON "stock_reservations"("status");

-- CreateIndex
CREATE INDEX "stock_reservations_expires_at_idx" ON "stock_reservations"("expires_at");

-- CreateIndex
CREATE INDEX "allocation_logs_product_id_idx" ON "allocation_logs"("product_id");

-- CreateIndex
CREATE INDEX "allocation_logs_allocated_seller_id_idx" ON "allocation_logs"("allocated_seller_id");

-- CreateIndex
CREATE INDEX "allocation_logs_order_id_idx" ON "allocation_logs"("order_id");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "seller_product_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
