-- Add locality field to sellers
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "locality" TEXT;

-- Add locality field to customer_addresses
ALTER TABLE "customer_addresses" ADD COLUMN IF NOT EXISTS "locality" TEXT;
