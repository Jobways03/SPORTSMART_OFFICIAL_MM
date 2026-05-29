-- Phase 159c (2026-05-26) — Referral Attribution audit.
--   - coupon_code_id: FK to the originating coupon (was a bare code string).
--   - status: attribution lifecycle (ACTIVE/REVERSED/FRAUD_VOIDED).
--   - updated_at: lifecycle timestamp.
--   - hard FKs: order_id → master_orders (Cascade), coupon_code_id →
--     affiliate_coupon_codes (SetNull).

CREATE TYPE "ReferralAttributionStatus" AS ENUM ('ACTIVE', 'REVERSED', 'FRAUD_VOIDED');

ALTER TABLE "referral_attributions" ADD COLUMN IF NOT EXISTS "coupon_code_id" TEXT;
ALTER TABLE "referral_attributions" ADD COLUMN IF NOT EXISTS "status" "ReferralAttributionStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "referral_attributions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "referral_attributions_customer_id_idx" ON "referral_attributions" ("customer_id");

-- order_id → master_orders. Existing rows reference real orders (orders are
-- never hard-deleted), so the constraint validates against current data.
ALTER TABLE "referral_attributions"
  ADD CONSTRAINT "referral_attributions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "master_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_attributions"
  ADD CONSTRAINT "referral_attributions_coupon_code_id_fkey"
  FOREIGN KEY ("coupon_code_id") REFERENCES "affiliate_coupon_codes" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
