-- Fix Order Schema Gaps Migration
-- Ensures all required columns, tables, enums, and seed data exist

-- Ensure master_sku column on order_items
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "master_sku" TEXT;

-- Ensure order_reassignment_logs table
CREATE TABLE IF NOT EXISTS "order_reassignment_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "master_order_id" TEXT NOT NULL,
  "sub_order_id" TEXT NOT NULL,
  "from_seller_id" TEXT,
  "to_seller_id" TEXT,
  "reason" TEXT,
  "successful" BOOLEAN NOT NULL DEFAULT true,
  "new_sub_order_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "order_reassignment_logs_master_order_id_idx" ON "order_reassignment_logs"("master_order_id");
CREATE INDEX IF NOT EXISTS "order_reassignment_logs_sub_order_id_idx" ON "order_reassignment_logs"("sub_order_id");

-- Ensure order_sequence has initial row
INSERT INTO "order_sequence" ("id", "last_number") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING;

-- Ensure PACKED, SHIPPED, CANCELLED in fulfillment enum
DO $$ BEGIN ALTER TYPE "OrderFulfillmentStatus" ADD VALUE IF NOT EXISTS 'PACKED'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "OrderFulfillmentStatus" ADD VALUE IF NOT EXISTS 'SHIPPED'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "OrderFulfillmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "OrderAcceptStatus" ADD VALUE IF NOT EXISTS 'CANCELLED'; EXCEPTION WHEN duplicate_object THEN null; END $$;
