-- Phase 8: Settlement & Commission (Model 1 pricing)

-- Add new enums
CREATE TYPE "CommissionRecordStatus" AS ENUM ('PENDING', 'SETTLED', 'REFUNDED');
CREATE TYPE "SettlementCycleStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'APPROVED', 'PAID');
CREATE TYPE "SellerSettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- Add MARGIN_BASED to CommissionType enum
ALTER TYPE "CommissionType" ADD VALUE IF NOT EXISTS 'MARGIN_BASED';

-- Add new Model 1 fields to commission_records
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "platform_price" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "settlement_price" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "total_platform_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "total_settlement_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "platform_margin" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "variant_title" TEXT;
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "status" "CommissionRecordStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "commission_records" ADD COLUMN IF NOT EXISTS "settlement_id" TEXT;

-- Create indexes on new fields
CREATE INDEX IF NOT EXISTS "commission_records_status_idx" ON "commission_records"("status");
CREATE INDEX IF NOT EXISTS "commission_records_settlement_id_idx" ON "commission_records"("settlement_id");
CREATE INDEX IF NOT EXISTS "commission_records_created_at_idx" ON "commission_records"("created_at");

-- Create settlement_cycles table
CREATE TABLE IF NOT EXISTS "settlement_cycles" (
    "id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "SettlementCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_margin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_cycles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "settlement_cycles_status_idx" ON "settlement_cycles"("status");
CREATE INDEX IF NOT EXISTS "settlement_cycles_period_idx" ON "settlement_cycles"("period_start", "period_end");

-- Create seller_settlements table
CREATE TABLE IF NOT EXISTS "seller_settlements" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "total_platform_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_settlement_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_platform_margin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SellerSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "utr_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "seller_settlements_cycle_id_seller_id_key" ON "seller_settlements"("cycle_id", "seller_id");
CREATE INDEX IF NOT EXISTS "seller_settlements_cycle_id_idx" ON "seller_settlements"("cycle_id");
CREATE INDEX IF NOT EXISTS "seller_settlements_seller_id_idx" ON "seller_settlements"("seller_id");
CREATE INDEX IF NOT EXISTS "seller_settlements_status_idx" ON "seller_settlements"("status");

-- Add foreign keys
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "settlement_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "seller_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
