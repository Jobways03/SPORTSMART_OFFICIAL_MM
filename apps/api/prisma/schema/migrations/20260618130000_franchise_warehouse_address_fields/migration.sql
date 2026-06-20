-- Franchise warehouse address parts (city / state / locality / country).
-- These fields existed on the FranchisePartner Prisma model
-- (warehouseCity / warehouseState / warehouseLocality / warehouseCountry)
-- WITHOUT a migration, so dev (and any other) database drifted: every
-- franchisePartner query — including login, whose findByEmail does a
-- findFirst that selects ALL columns — failed with
-- P2022 "column franchise_partners.warehouse_city does not exist" → 500
-- ("Something went wrong" on the franchise login page).
-- This adds the missing nullable columns to match the committed model.
-- IF NOT EXISTS keeps it safe in databases where the columns were already
-- hot-patched in to recover login.
ALTER TABLE "franchise_partners"
  ADD COLUMN IF NOT EXISTS "warehouse_city" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouse_state" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouse_locality" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouse_country" TEXT;
