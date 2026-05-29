-- Phase 159d (2026-05-26) — Affiliate Commission Lifecycle audit.
--   - actor columns for manual transitions (null = SYSTEM/cron).
--   - explicit FKs: referral_attribution_id (1:1), coupon_code_id, and a hard
--     order_id → master_orders FK (was a bare String @unique).

ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "confirmed_by_id" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "cancelled_by_id" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "reversed_by_id" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "held_by_id" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "referral_attribution_id" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "coupon_code_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_referral_attribution_id_key"
  ON "affiliate_commissions" ("referral_attribution_id");

ALTER TABLE "affiliate_commissions"
  ADD CONSTRAINT "affiliate_commissions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "master_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_commissions"
  ADD CONSTRAINT "affiliate_commissions_referral_attribution_id_fkey"
  FOREIGN KEY ("referral_attribution_id") REFERENCES "referral_attributions" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "affiliate_commissions"
  ADD CONSTRAINT "affiliate_commissions_coupon_code_id_fkey"
  FOREIGN KEY ("coupon_code_id") REFERENCES "affiliate_coupon_codes" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
