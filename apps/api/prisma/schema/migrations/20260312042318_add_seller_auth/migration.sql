-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "seller_shop_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_sessions" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_password_reset_otps" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_key" ON "sellers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_phone_number_key" ON "sellers"("phone_number");

-- CreateIndex
CREATE INDEX "seller_sessions_seller_id_idx" ON "seller_sessions"("seller_id");

-- CreateIndex
CREATE INDEX "seller_sessions_refresh_token_idx" ON "seller_sessions"("refresh_token");

-- CreateIndex
CREATE UNIQUE INDEX "seller_password_reset_otps_reset_token_key" ON "seller_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "seller_password_reset_otps_seller_id_idx" ON "seller_password_reset_otps"("seller_id");

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_password_reset_otps" ADD CONSTRAINT "seller_password_reset_otps_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
