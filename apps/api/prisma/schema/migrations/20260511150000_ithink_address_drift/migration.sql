-- Migration: iThink address-drift detection
--
-- 1. STALE value on IThinkWarehouseApprovalStatus — flagged when the
--    seller/franchise updated their address after registration.
-- 2. ithink_registered_address_hash columns on sellers + franchise_partners.
--    Stores SHA-256(address || city || state || pincode || phone) at the
--    time of registration so drift can be detected on the next profile save.
-- 3. return_address_id_snapshot on sub_orders — pins the return warehouse
--    id used by the original AWB so RTOs / reverse pickups still resolve
--    correctly even after re-registration changes the seller's current id.
--
-- Postgres requires ALTER TYPE ... ADD VALUE outside a transaction. Prisma
-- migrate runs each migration in its own transaction by default, which
-- conflicts with this. We split the enum extension into its own statement
-- and rely on Prisma's per-statement non-transactional handling
-- (statements separated by `;` are run individually).

ALTER TYPE "IThinkWarehouseApprovalStatus" ADD VALUE IF NOT EXISTS 'STALE';

ALTER TABLE "sellers"
  ADD COLUMN "ithink_registered_address_hash" TEXT;

ALTER TABLE "franchise_partners"
  ADD COLUMN "ithink_registered_address_hash" TEXT;

ALTER TABLE "sub_orders"
  ADD COLUMN "return_address_id_snapshot" TEXT;
