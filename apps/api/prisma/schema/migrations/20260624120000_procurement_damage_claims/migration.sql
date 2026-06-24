-- CreateEnum
CREATE TYPE "ProcurementDamageClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "procurement_request_items" ADD COLUMN "approved_damaged_qty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "procurement_damage_claims" (
    "id" TEXT NOT NULL,
    "procurement_request_id" TEXT NOT NULL,
    "procurement_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "global_sku" TEXT NOT NULL,
    "claimed_qty" INTEGER NOT NULL,
    "status" "ProcurementDamageClaimStatus" NOT NULL DEFAULT 'PENDING',
    "franchise_note" TEXT,
    "reviewed_by_admin_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "raised_by_actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_damage_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_damage_claim_images" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "caption" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_damage_claim_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "procurement_damage_claims_procurement_request_id_idx" ON "procurement_damage_claims"("procurement_request_id");

-- CreateIndex
CREATE INDEX "procurement_damage_claims_status_created_at_idx" ON "procurement_damage_claims"("status", "created_at");

-- CreateIndex
CREATE INDEX "procurement_damage_claims_procurement_item_id_idx" ON "procurement_damage_claims"("procurement_item_id");

-- CreateIndex
CREATE INDEX "procurement_damage_claim_images_claim_id_idx" ON "procurement_damage_claim_images"("claim_id");

-- AddForeignKey
ALTER TABLE "procurement_damage_claims" ADD CONSTRAINT "procurement_damage_claims_procurement_request_id_fkey" FOREIGN KEY ("procurement_request_id") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_damage_claims" ADD CONSTRAINT "procurement_damage_claims_procurement_item_id_fkey" FOREIGN KEY ("procurement_item_id") REFERENCES "procurement_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_damage_claim_images" ADD CONSTRAINT "procurement_damage_claim_images_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "procurement_damage_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
