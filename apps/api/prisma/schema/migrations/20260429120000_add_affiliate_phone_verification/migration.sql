-- AlterTable
ALTER TABLE "affiliates"
  ADD COLUMN "phone_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phone_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "affiliate_phone_verification_otps" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "phone_candidate" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_phone_verification_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_phone_verification_otps_affiliate_id_idx" ON "affiliate_phone_verification_otps"("affiliate_id");

-- AddForeignKey
ALTER TABLE "affiliate_phone_verification_otps" ADD CONSTRAINT "affiliate_phone_verification_otps_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
