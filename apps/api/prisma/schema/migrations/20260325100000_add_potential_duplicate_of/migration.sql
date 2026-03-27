-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "potential_duplicate_of" TEXT;
