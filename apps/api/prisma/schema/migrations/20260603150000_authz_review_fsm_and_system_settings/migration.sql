-- Authz denial false-positive review FSM + admin-editable SystemSetting.

-- CreateEnum
CREATE TYPE "AuthzReviewStatus" AS ENUM ('UNREVIEWED', 'FALSE_POSITIVE', 'EXPECTED_DENY', 'FIXED', 'IGNORED');

-- AlterTable: review FSM columns on authorization_audits
ALTER TABLE "authorization_audits"
  ADD COLUMN "review_status" "AuthzReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "reviewed_by_admin_id" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "review_note" TEXT;

-- CreateIndex
CREATE INDEX "authorization_audits_review_status_decision_created_at_idx" ON "authorization_audits"("review_status", "decision", "created_at");

-- CreateTable: system_settings (runtime authz-mode overrides, tighten-only)
CREATE TABLE "system_settings" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "category" TEXT,
  "updated_by_admin_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");
