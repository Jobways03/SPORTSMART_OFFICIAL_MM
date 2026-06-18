-- Backfill the BusinessEntityType enum + entity_type columns that the Prisma
-- schema declares but were never migrated.
--
-- `entityType BusinessEntityType?` was added to FranchisePartner (franchise.prisma)
-- and Seller (seller.prisma) in commit 5c1710a and the client was regenerated,
-- but no migration ever created the Postgres enum type or the columns. Prisma's
-- findMany selects every scalar field, so `GET /admin/franchises` issued
-- `SELECT ... entity_type ...` against a table with no such column → P2022
-- ("column franchise_partners.entity_type does not exist") → HTTP 500 on the
-- Franchises admin page. The same drift breaks the seller list/detail reads and
-- the franchise/seller onboarding write path. This migration adds them.

-- CreateEnum
CREATE TYPE "BusinessEntityType" AS ENUM ('PUBLIC_LIMITED', 'PRIVATE_LIMITED', 'SOLE_PROPRIETORSHIP', 'GENERAL_PARTNERSHIP', 'LLP');

-- AlterTable
ALTER TABLE "franchise_partners" ADD COLUMN "entity_type" "BusinessEntityType";
ALTER TABLE "sellers" ADD COLUMN "entity_type" "BusinessEntityType";
