-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('SELLER', 'OWN_BRAND');

-- CreateEnum
CREATE TYPE "OwnBrandProcurementStatus" AS ENUM ('DRAFT', 'PLACED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "product_source" "ProductSource" NOT NULL DEFAULT 'SELLER',
  ADD COLUMN "own_brand_sku" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_own_brand_sku_key" ON "products"("own_brand_sku");

-- CreateTable
CREATE TABLE "own_brand_warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_brand_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "own_brand_warehouses_code_key" ON "own_brand_warehouses"("code");

-- CreateTable
CREATE TABLE "own_brand_stocks" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "last_landed_cost" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_brand_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "own_brand_stocks_warehouse_id_product_id_variant_id_key" ON "own_brand_stocks"("warehouse_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "own_brand_stocks_product_id_idx" ON "own_brand_stocks"("product_id");

-- CreateIndex
CREATE INDEX "own_brand_stocks_variant_id_idx" ON "own_brand_stocks"("variant_id");

-- CreateTable
CREATE TABLE "own_brand_procurement_orders" (
    "id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "status" "OwnBrandProcurementStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_date" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "supplier_reference" TEXT,
    "notes" TEXT,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_brand_procurement_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "own_brand_procurement_orders_po_number_key" ON "own_brand_procurement_orders"("po_number");

-- CreateIndex
CREATE INDEX "own_brand_procurement_orders_warehouse_id_status_idx" ON "own_brand_procurement_orders"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "own_brand_procurement_orders_po_number_idx" ON "own_brand_procurement_orders"("po_number");

-- CreateTable
CREATE TABLE "own_brand_procurement_order_items" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "own_brand_sku" TEXT,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "own_brand_procurement_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "own_brand_procurement_order_items_po_id_idx" ON "own_brand_procurement_order_items"("po_id");

-- CreateIndex
CREATE INDEX "own_brand_procurement_order_items_product_id_idx" ON "own_brand_procurement_order_items"("product_id");

-- CreateTable
CREATE TABLE "own_brand_procurement_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "own_brand_procurement_sequence_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "own_brand_stocks" ADD CONSTRAINT "own_brand_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "own_brand_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_brand_procurement_orders" ADD CONSTRAINT "own_brand_procurement_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "own_brand_warehouses"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_brand_procurement_order_items" ADD CONSTRAINT "own_brand_procurement_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "own_brand_procurement_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
