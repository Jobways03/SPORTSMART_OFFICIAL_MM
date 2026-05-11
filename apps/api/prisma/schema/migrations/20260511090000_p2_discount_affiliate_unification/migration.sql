-- Phase F (P2.3) — Affiliate ↔ Discount unification.
--
-- Two parallel coupon systems existed before this migration:
--
--   1. discounts                — the upgraded pipeline (allocation,
--      eligibility, fraud, audit, approval, budget).
--   2. affiliate_coupon_codes   — affiliate-issued codes with
--      attribution + commission lifecycle in the affiliate module.
--
-- The bridge in DiscountsService.validateCouponForCheckout fell
-- through to AffiliatePublicFacade for codes the Discount table
-- didn't recognise, so affiliate-issued codes bypassed every new
-- feature (eligibility, fraud rate-limit, allocation/ledger,
-- reservation lifecycle, audit/outbox, budget).
--
-- This migration introduces a two-way bridge so an affiliate coupon
-- can natively live in the Discount table while keeping the
-- AffiliateCouponCode row for the affiliate metadata (commission %,
-- click attribution). New affiliate coupons are issued as a Discount
-- with affiliate_id set; legacy AffiliateCouponCode rows can be
-- unified one-by-one via the admin endpoint (each gets a mirror
-- Discount). Until unified, the legacy fallback path still works.
--
-- Backward compatibility:
--   - affiliateId / affiliateCommissionPercent default to NULL —
--     existing Discount rows behave exactly as before.
--   - discountId on AffiliateCouponCode defaults to NULL — legacy
--     rows pass through the existing facade.

ALTER TABLE "discounts"
  ADD COLUMN IF NOT EXISTS "affiliate_id"                  TEXT,
  ADD COLUMN IF NOT EXISTS "affiliate_commission_percent"  DECIMAL(5,2);

CREATE INDEX IF NOT EXISTS "discounts_affiliate_id_idx"
  ON "discounts" ("affiliate_id");

-- Bridge column. Nullable so legacy rows survive the migration;
-- UNIQUE so a single AffiliateCouponCode never points to two
-- Discounts (each AffiliateCouponCode has at most one mirror).
ALTER TABLE "affiliate_coupon_codes"
  ADD COLUMN IF NOT EXISTS "discount_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_coupon_codes_discount_id_key"
  ON "affiliate_coupon_codes" ("discount_id")
  WHERE "discount_id" IS NOT NULL;

-- FK on the bridge. RESTRICT (default) prevents deleting a Discount
-- that an AffiliateCouponCode still points to — protects the
-- attribution path. If a Discount needs to be deleted, the admin
-- has to clear the link on AffiliateCouponCode first.
ALTER TABLE "affiliate_coupon_codes"
  ADD CONSTRAINT "affiliate_coupon_codes_discount_id_fkey"
  FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
