-- Phase 157 (2026-05-26) — Affiliate Application Approval audit.
--   - One PRIMARY coupon per affiliate, enforced at the DB (partial unique).
--     The approve flow's find-before-create is defence-in-app; this is the
--     defence-in-DB backstop against any other write path / concurrency.
--   - is_primary default flips to FALSE (only the approval flow sets it true).
ALTER TABLE "affiliate_coupon_codes" ALTER COLUMN "is_primary" SET DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_coupon_one_primary"
  ON "affiliate_coupon_codes" ("affiliate_id")
  WHERE "is_primary" = true;
