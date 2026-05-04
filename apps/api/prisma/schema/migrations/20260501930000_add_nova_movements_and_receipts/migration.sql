-- CreateEnum
CREATE TYPE "OwnBrandStockMovementKind" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "own_brand_stock_movements" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "kind" "OwnBrandStockMovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "reason" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "own_brand_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "own_brand_stock_movements_warehouse_id_product_id_variant_i_idx"
  ON "own_brand_stock_movements"("warehouse_id", "product_id", "variant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "own_brand_stock_movements_ref_type_ref_id_idx"
  ON "own_brand_stock_movements"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "own_brand_stock_movements_kind_created_at_idx"
  ON "own_brand_stock_movements"("kind", "created_at" DESC);

-- CreateTable
CREATE TABLE "own_brand_procurement_receipts" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "po_item_id" TEXT NOT NULL,
    "quantity_received" INTEGER NOT NULL,
    "notes" TEXT,
    "received_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "own_brand_procurement_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "own_brand_procurement_receipts_po_id_created_at_idx"
  ON "own_brand_procurement_receipts"("po_id", "created_at");

-- CreateIndex
CREATE INDEX "own_brand_procurement_receipts_po_item_id_idx"
  ON "own_brand_procurement_receipts"("po_item_id");
