-- AlterTable: Add low_stock_threshold to seller_product_mappings
ALTER TABLE "seller_product_mappings" ADD COLUMN "low_stock_threshold" INTEGER NOT NULL DEFAULT 5;
