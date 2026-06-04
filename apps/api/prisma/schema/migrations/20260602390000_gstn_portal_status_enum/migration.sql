-- Phase 200 (Customer Tax Profile audit #8) — promote the free-text
-- gstn_portal_status to a first-class enum on BOTH seller_gstins and
-- customer_tax_profiles.
--
-- The shared GstnVerificationService only ever wrote one of the five
-- GstnTaxpayerStatus members (ACTIVE / SUSPENDED / CANCELLED / INACTIVE /
-- UNKNOWN), so every existing value already matches an enum label. Any
-- unexpected legacy free-text value is normalised to UNKNOWN before the cast so
-- the ALTER cannot fail mid-deploy.

-- 1. Create the enum type (idempotent guard for re-run safety).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GstnPortalStatus') THEN
    CREATE TYPE "GstnPortalStatus" AS ENUM (
      'ACTIVE', 'SUSPENDED', 'CANCELLED', 'INACTIVE', 'UNKNOWN'
    );
  END IF;
END
$$;

-- 2. Normalise any out-of-vocabulary legacy values to UNKNOWN so the USING cast
--    is total.
UPDATE "seller_gstins"
SET "gstn_portal_status" = 'UNKNOWN'
WHERE "gstn_portal_status" IS NOT NULL
  AND "gstn_portal_status" NOT IN ('ACTIVE','SUSPENDED','CANCELLED','INACTIVE','UNKNOWN');

UPDATE "customer_tax_profiles"
SET "gstn_portal_status" = 'UNKNOWN'
WHERE "gstn_portal_status" IS NOT NULL
  AND "gstn_portal_status" NOT IN ('ACTIVE','SUSPENDED','CANCELLED','INACTIVE','UNKNOWN');

-- 3. Convert the columns. NULL stays NULL (portal not yet consulted).
ALTER TABLE "seller_gstins"
  ALTER COLUMN "gstn_portal_status" TYPE "GstnPortalStatus"
  USING ("gstn_portal_status"::"GstnPortalStatus");

ALTER TABLE "customer_tax_profiles"
  ALTER COLUMN "gstn_portal_status" TYPE "GstnPortalStatus"
  USING ("gstn_portal_status"::"GstnPortalStatus");
