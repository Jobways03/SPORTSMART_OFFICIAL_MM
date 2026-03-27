-- Create enum
DO $$ BEGIN
  CREATE TYPE "MappingApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'STOPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Add column
ALTER TABLE "seller_product_mappings" ADD COLUMN IF NOT EXISTS "approval_status" "MappingApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL';

-- Backfill existing data
UPDATE "seller_product_mappings" SET "approval_status" = 'APPROVED' WHERE "is_active" = true;
UPDATE "seller_product_mappings" SET "approval_status" = 'STOPPED' WHERE "is_active" = false;

-- Index
CREATE INDEX IF NOT EXISTS "seller_product_mappings_approval_status_idx" ON "seller_product_mappings"("approval_status");
