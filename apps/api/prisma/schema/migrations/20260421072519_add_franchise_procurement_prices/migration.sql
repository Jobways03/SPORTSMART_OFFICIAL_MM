-- Per-franchise negotiated procurement price.
-- (Option C — Admin-visible override that takes precedence over
-- ProductVariant.costPrice when pre-filling the procurement approval
-- modal. Each row represents a live negotiation between the platform
-- and one franchise for one SKU.)

-- CreateTable
CREATE TABLE "franchise_procurement_prices" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "landed_unit_cost" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_procurement_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "franchise_procurement_prices_franchise_id_product_id_variant_id_key"
  ON "franchise_procurement_prices"("franchise_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "franchise_procurement_prices_franchise_id_idx"
  ON "franchise_procurement_prices"("franchise_id");

-- AddForeignKey
ALTER TABLE "franchise_procurement_prices"
  ADD CONSTRAINT "franchise_procurement_prices_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
