-- Phase 158 (2026-05-26) — Affiliate Coupon Customer-Discount audit.
--   - customer_discount_type String → enum (defence-in-depth) + FREE_SHIPPING.
--   - max_discount_amount: cap for PERCENT discounts (uncapped % was the
--     headline production risk).
--   - starts_at: scheduled activation window.

CREATE TYPE "AffiliateCustomerDiscountType" AS ENUM ('PERCENT', 'FIXED', 'FREE_SHIPPING');

-- Existing rows only ever held 'PERCENT' / 'FIXED' / NULL (service-validated),
-- so the cast is total. NULL stays NULL (attribution-only).
ALTER TABLE "affiliate_coupon_codes"
  ALTER COLUMN "customer_discount_type" TYPE "AffiliateCustomerDiscountType"
  USING "customer_discount_type"::"AffiliateCustomerDiscountType";

ALTER TABLE "affiliate_coupon_codes" ADD COLUMN IF NOT EXISTS "max_discount_amount" DECIMAL(10,2);
ALTER TABLE "affiliate_coupon_codes" ADD COLUMN IF NOT EXISTS "starts_at" TIMESTAMP(3);
