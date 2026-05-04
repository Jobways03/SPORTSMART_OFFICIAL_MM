-- AlterTable
ALTER TABLE "wallets"
  ADD COLUMN "is_blocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blocked_reason" TEXT,
  ADD COLUMN "blocked_at" TIMESTAMP(3),
  ADD COLUMN "blocked_by_admin_id" TEXT;
