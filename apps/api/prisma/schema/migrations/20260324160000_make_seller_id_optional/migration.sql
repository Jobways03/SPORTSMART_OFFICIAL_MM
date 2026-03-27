-- AlterTable: Make sellerId optional on products (platform-created products have no seller)
ALTER TABLE "products" ALTER COLUMN "seller_id" DROP NOT NULL;

-- Drop the CASCADE foreign key and recreate as SET NULL
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_seller_id_fkey";
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
