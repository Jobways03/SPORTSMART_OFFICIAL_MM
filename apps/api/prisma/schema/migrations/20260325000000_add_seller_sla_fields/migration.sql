-- AlterTable: Add seller SLA fields to sub_orders
ALTER TABLE "sub_orders" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
ALTER TABLE "sub_orders" ADD COLUMN IF NOT EXISTS "rejection_note" TEXT;
ALTER TABLE "sub_orders" ADD COLUMN IF NOT EXISTS "expected_dispatch_date" TIMESTAMP(3);
