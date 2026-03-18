-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "detailed_store_description" TEXT,
ADD COLUMN     "is_profile_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_profile_updated_at" TIMESTAMP(3),
ADD COLUMN     "profile_completion_percentage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seller_contact_country_code" TEXT,
ADD COLUMN     "seller_contact_number" TEXT,
ADD COLUMN     "seller_policy" TEXT,
ADD COLUMN     "seller_profile_image_public_id" TEXT,
ADD COLUMN     "seller_profile_image_url" TEXT,
ADD COLUMN     "seller_shop_logo_public_id" TEXT,
ADD COLUMN     "seller_shop_logo_url" TEXT,
ADD COLUMN     "seller_zip_code" TEXT,
ADD COLUMN     "short_store_description" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "store_address" TEXT;

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");

-- CreateIndex
CREATE INDEX "sellers_is_profile_completed_idx" ON "sellers"("is_profile_completed");
