-- Add OrderStatus enum type
DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'PENDING_VERIFICATION', 'VERIFIED', 'ROUTED_TO_SELLER', 'SELLER_ACCEPTED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'EXCEPTION_QUEUE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Add columns to master_orders
ALTER TABLE "master_orders" ADD COLUMN IF NOT EXISTS "order_status" "OrderStatus" NOT NULL DEFAULT 'PLACED';
ALTER TABLE "master_orders" ADD COLUMN IF NOT EXISTS "verified_by" TEXT;
ALTER TABLE "master_orders" ADD COLUMN IF NOT EXISTS "verification_remarks" TEXT;

-- Add accept deadline to sub_orders
ALTER TABLE "sub_orders" ADD COLUMN IF NOT EXISTS "accept_deadline_at" TIMESTAMP(3);

-- Create index
CREATE INDEX IF NOT EXISTS "master_orders_order_status_idx" ON "master_orders"("order_status");

-- Update existing orders: if verified=true, set status to ROUTED_TO_SELLER; else PLACED
UPDATE "master_orders" SET "order_status" = 'ROUTED_TO_SELLER' WHERE verified = true;
UPDATE "master_orders" SET "order_status" = 'PLACED' WHERE verified = false;
