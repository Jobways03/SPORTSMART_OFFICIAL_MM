-- Phase 159q (2026-05-27) — Franchise POS Sale Flow audit.
-- #8/#9 promote free-string sale_type + payment_method to enums; #6 payment
-- settlement state; #10 tax-invoice state; #13 commission-rate snapshot; #15
-- paymentMethod report index. New enum TYPES are created and used in the same
-- transaction, which PostgreSQL permits (unlike ALTER TYPE ... ADD VALUE).

-- New enum types -------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "PosSaleType" AS ENUM ('WALK_IN', 'PHONE_ORDER', 'LOCAL_DELIVERY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PosPaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PosTaxInvoiceStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- #9 sale_type String -> PosSaleType (existing values already match labels) ---
ALTER TABLE "franchise_pos_sales" ALTER COLUMN "sale_type" DROP DEFAULT;
ALTER TABLE "franchise_pos_sales"
  ALTER COLUMN "sale_type" TYPE "PosSaleType" USING "sale_type"::"PosSaleType";
ALTER TABLE "franchise_pos_sales" ALTER COLUMN "sale_type" SET DEFAULT 'WALK_IN';

-- #8 payment_method String -> PosPaymentMethod ------------------------------
ALTER TABLE "franchise_pos_sales" ALTER COLUMN "payment_method" DROP DEFAULT;
ALTER TABLE "franchise_pos_sales"
  ALTER COLUMN "payment_method" TYPE "PosPaymentMethod" USING "payment_method"::"PosPaymentMethod";
ALTER TABLE "franchise_pos_sales" ALTER COLUMN "payment_method" SET DEFAULT 'CASH';

-- #6 / #10 / #13 new columns -------------------------------------------------
ALTER TABLE "franchise_pos_sales"
  ADD COLUMN IF NOT EXISTS "payment_status" "PosPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "payment_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_settled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tax_invoice_status" "PosTaxInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "tax_invoice_id" TEXT,
  ADD COLUMN IF NOT EXISTS "commission_rate" DECIMAL(5, 2);

-- #15 report index -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS "franchise_pos_sales_franchise_id_payment_method_sold_at_idx"
  ON "franchise_pos_sales" ("franchise_id", "payment_method", "sold_at");
