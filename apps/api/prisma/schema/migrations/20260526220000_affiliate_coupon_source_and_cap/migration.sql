-- Phase 159b (2026-05-26) — Affiliate Additional Coupon Code generation.
--   - coupon_source: distinguish system-generated (REGISTRATION_AUTO) from
--     admin-added (ADMIN_MANUAL) codes for finance/audit filtering.
--   - created_by_admin_id: who created the code (the approver for auto codes,
--     the acting admin for manual ones).
--   - max_codes_per_affiliate: per-affiliate cap on the create endpoint.

CREATE TYPE "AffiliateCouponSource" AS ENUM ('REGISTRATION_AUTO', 'ADMIN_MANUAL', 'CAMPAIGN');

ALTER TABLE "affiliate_coupon_codes"
  ADD COLUMN IF NOT EXISTS "coupon_source" "AffiliateCouponSource" NOT NULL DEFAULT 'REGISTRATION_AUTO';
ALTER TABLE "affiliate_coupon_codes"
  ADD COLUMN IF NOT EXISTS "created_by_admin_id" TEXT;

ALTER TABLE "affiliate_settings"
  ADD COLUMN IF NOT EXISTS "max_codes_per_affiliate" INTEGER NOT NULL DEFAULT 10;
