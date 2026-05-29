-- Phase 38 (2026-05-19) — split sellers into D2C and RETAIL classes.
--
-- Adds a discriminator column on sellers + the SellerType enum. Each
-- seller class is now managed by a dedicated admin team via a
-- dedicated admin app (web-d2c-seller-admin :4001 and
-- web-retail-seller-admin :4008), and onboards through a dedicated
-- seller portal (web-d2c-seller :4003 and web-retail-seller :4009).
--
-- Strategy:
--   1. Create the enum.
--   2. Add the column with default 'D2C' so every existing row is
--      backfilled atomically (no separate UPDATE pass needed).
--   3. Index it for the per-type list queries the admin pages run.
--   4. Drop the DEFAULT after backfill so new rows must declare a
--      type explicitly (caught at the DTO layer, but DB-level safety
--      net is cheap).
--
-- Rollback: DROP COLUMN seller_type + DROP TYPE "SellerType". Safe;
-- nothing downstream FKs on this column.

CREATE TYPE "SellerType" AS ENUM ('D2C', 'RETAIL');

ALTER TABLE "sellers"
    ADD COLUMN "seller_type" "SellerType" NOT NULL DEFAULT 'D2C';

CREATE INDEX "sellers_seller_type_idx" ON "sellers" ("seller_type");

-- Keep the DEFAULT in place: makes seed-data + ad-hoc admin SQL
-- inserts forgiving. The application enforces explicit type on the
-- DTO layer (CreateSellerDto).
