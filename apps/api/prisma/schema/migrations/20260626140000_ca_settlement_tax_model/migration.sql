-- Phase 253 — CA-approved settlement tax model.
--
-- The CA-approved worked example (₹5000 GST-inclusive @ 5%):
--   taxable value 5000/1.05      = ₹4761.90
--   commission @10% × taxable    = ₹476.19
--   GST @18% on commission       = ₹85.71   (vendor reclaims as ITC)
--   §52 TCS @1% × taxable        = ₹47.62   (deposited under platform TCS GSTIN,
--                                            tagged to the vendor's GSTIN)
--   §194-O TDS                   = none     (not deducted in this model)
--   → vendor payout = 5000 − 47.62 − (476.19 + 85.71) = ₹4390.48
--
-- This migration:
--   1. Adds the per-settlement net-taxable-supply snapshot (the §52 TCS base) to
--      both settlement tables.
--   2. Pins the settlement-tax config to the CA-approved values: §52 TCS on the
--      net taxable supply (was the commission-GST amount, which under-withheld);
--      §194-O TDS disabled (the payout deducts only commission + GST + TCS).
--
-- Additive + idempotent; forward-only (the platform ships no down-migrations).
-- Both config rows are reversible from the admin "Settlement Charges" page.

-- 1. Net taxable supply (§52 TCS base) — read by the TCS hook as 1% × this.
ALTER TABLE "seller_settlements"
  ADD COLUMN IF NOT EXISTS "total_taxable_supply" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "seller_settlements"
  ADD COLUMN IF NOT EXISTS "total_taxable_supply_in_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "franchise_settlements"
  ADD COLUMN IF NOT EXISTS "total_taxable_supply" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "franchise_settlements"
  ADD COLUMN IF NOT EXISTS "total_taxable_supply_in_paise" BIGINT NOT NULL DEFAULT 0;

-- 2. Pin the CA-approved settlement-tax config. The code DEFAULT already points
-- here; this makes the change live + deterministic even on an install where an
-- admin previously persisted the old values (e.g. tcs_base_type='GST').
-- Note: `value` is left as an untyped string literal so PostgreSQL coerces it to
-- the column's own type (json or jsonb) — no explicit ::jsonb cast that would
-- break on a json column.
INSERT INTO "tax_config" ("id", "key", "value", "description", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'tcs_base_type', '"TAXABLE_SUPPLY"',
   'Phase 253 — §52 TCS levied on the net taxable supply (ex-GST), per the CA-approved model.',
   NOW(), NOW()),
  (gen_random_uuid(), 'tds_enabled', 'false',
   'Phase 253 — §194-O TDS disabled in the CA-approved settlement model (payout = commission + GST + TCS only). Reversible via the admin Settlement Charges page.',
   NOW(), NOW())
ON CONFLICT ("key") DO UPDATE
  SET "value" = EXCLUDED."value",
      "description" = EXCLUDED."description",
      "updated_at" = NOW();
