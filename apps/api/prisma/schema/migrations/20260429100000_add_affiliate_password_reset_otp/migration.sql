-- CreateTable
CREATE TABLE "affiliate_password_reset_otps" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_password_reset_otps_reset_token_key" ON "affiliate_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "affiliate_password_reset_otps_affiliate_id_idx" ON "affiliate_password_reset_otps"("affiliate_id");

-- AddForeignKey
ALTER TABLE "affiliate_password_reset_otps" ADD CONSTRAINT "affiliate_password_reset_otps_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
