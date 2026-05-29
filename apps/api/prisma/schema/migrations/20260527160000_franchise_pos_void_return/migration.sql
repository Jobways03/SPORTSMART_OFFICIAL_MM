-- Phase 159r (2026-05-27) — Franchise POS Void/Return audit.
-- #1 cumulative returnedQty; #6 first-class return records; #7 item condition;
-- #10 void/return actor cols; #11 refundedAmount; #12 refundMethod/reason.

-- New enum types (CREATE TYPE + immediate use is permitted in one tx) ---------
DO $$ BEGIN
  CREATE TYPE "PosRefundMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PosReturnItemCondition" AS ENUM ('SALEABLE', 'DAMAGED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- #1 cumulative-returned counter on the sale item ----------------------------
ALTER TABLE "franchise_pos_sale_items"
  ADD COLUMN IF NOT EXISTS "returned_qty" INTEGER NOT NULL DEFAULT 0;

-- #10 / #11 sale-level audit + refund columns --------------------------------
ALTER TABLE "franchise_pos_sales"
  ADD COLUMN IF NOT EXISTS "refunded_amount" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "voided_by" TEXT,
  ADD COLUMN IF NOT EXISTS "returned_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returned_by" TEXT,
  ADD COLUMN IF NOT EXISTS "return_reason" TEXT;

-- #6 first-class return records ----------------------------------------------
CREATE TABLE IF NOT EXISTS "franchise_pos_returns" (
  "id" TEXT NOT NULL,
  "return_number" TEXT NOT NULL,
  "sale_id" TEXT NOT NULL,
  "franchise_id" TEXT NOT NULL,
  "refund_amount" DECIMAL(10, 2) NOT NULL,
  "refund_method" "PosRefundMethod" NOT NULL,
  "refund_reference" TEXT,
  "return_reason" TEXT,
  "returned_by" TEXT,
  "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_pos_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "franchise_pos_returns_return_number_key"
  ON "franchise_pos_returns" ("return_number");
CREATE INDEX IF NOT EXISTS "franchise_pos_returns_sale_id_idx"
  ON "franchise_pos_returns" ("sale_id");
CREATE INDEX IF NOT EXISTS "franchise_pos_returns_franchise_id_returned_at_idx"
  ON "franchise_pos_returns" ("franchise_id", "returned_at");
ALTER TABLE "franchise_pos_returns"
  ADD CONSTRAINT "franchise_pos_returns_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "franchise_pos_sales" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "franchise_pos_return_items" (
  "id" TEXT NOT NULL,
  "return_id" TEXT NOT NULL,
  "sale_item_id" TEXT NOT NULL,
  "return_qty" INTEGER NOT NULL,
  "condition" "PosReturnItemCondition" NOT NULL DEFAULT 'SALEABLE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_pos_return_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_pos_return_items_return_id_idx"
  ON "franchise_pos_return_items" ("return_id");
CREATE INDEX IF NOT EXISTS "franchise_pos_return_items_sale_item_id_idx"
  ON "franchise_pos_return_items" ("sale_item_id");
ALTER TABLE "franchise_pos_return_items"
  ADD CONSTRAINT "franchise_pos_return_items_return_id_fkey"
  FOREIGN KEY ("return_id") REFERENCES "franchise_pos_returns" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
