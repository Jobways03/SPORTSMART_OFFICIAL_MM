-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SELLER_ADMIN', 'SELLER_SUPPORT', 'SELLER_OPERATIONS');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SellerVerificationStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW');

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verification_status" "SellerVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED';

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SELLER_ADMIN',
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_seeded" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_action_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "action_type" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_action_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_impersonation_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "token_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_impersonation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_seller_messages" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "sent_by_admin_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_seller_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_role_idx" ON "admins"("role");

-- CreateIndex
CREATE INDEX "admins_status_idx" ON "admins"("status");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_refresh_token_idx" ON "admin_sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_admin_id_idx" ON "admin_action_audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_seller_id_idx" ON "admin_action_audit_logs"("seller_id");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_action_type_idx" ON "admin_action_audit_logs"("action_type");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_created_at_idx" ON "admin_action_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_admin_id_idx" ON "admin_impersonation_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_seller_id_idx" ON "admin_impersonation_logs"("seller_id");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_is_active_idx" ON "admin_impersonation_logs"("is_active");

-- CreateIndex
CREATE INDEX "admin_seller_messages_seller_id_idx" ON "admin_seller_messages"("seller_id");

-- CreateIndex
CREATE INDEX "admin_seller_messages_sent_by_admin_id_idx" ON "admin_seller_messages"("sent_by_admin_id");

-- CreateIndex
CREATE INDEX "admin_seller_messages_created_at_idx" ON "admin_seller_messages"("created_at");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_action_audit_logs" ADD CONSTRAINT "admin_action_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_impersonation_logs" ADD CONSTRAINT "admin_impersonation_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_seller_messages" ADD CONSTRAINT "admin_seller_messages_sent_by_admin_id_fkey" FOREIGN KEY ("sent_by_admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
