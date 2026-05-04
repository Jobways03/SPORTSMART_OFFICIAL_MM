CREATE TABLE "low_stock_alerts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seller_product_mapping_id" TEXT NOT NULL UNIQUE,
  "seller_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "current_stock" INTEGER NOT NULL,
  "threshold" INTEGER NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "low_stock_alerts_resolved_at_idx" ON "low_stock_alerts"("resolved_at");
