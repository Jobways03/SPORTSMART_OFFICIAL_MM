-- Phase 247-FB (MVP) — FRANCHISE discount-funding party + BRAND attribution.
-- A franchise (or brand) funds its own promo and bears the cost via settlement
-- instead of the platform silently absorbing it. Additive + idempotent; no
-- backfill needed (existing rows are PLATFORM/SELLER/BRAND/SHARED with NULL
-- franchise/brand attribution, unchanged).

-- New funding/liability party value (not used as a default in this migration,
-- so adding it alongside column adds is safe).
ALTER TYPE "DiscountFundingType"    ADD VALUE IF NOT EXISTS 'FRANCHISE';
ALTER TYPE "DiscountLiabilityParty" ADD VALUE IF NOT EXISTS 'FRANCHISE';

-- Discount: franchise share + which franchise/brand funds it.
ALTER TABLE "discounts"
  ADD COLUMN IF NOT EXISTS "franchise_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "funding_franchise_id" TEXT,
  ADD COLUMN IF NOT EXISTS "funding_brand_id" TEXT;

-- Liability ledger: per-row franchise/brand attribution (mirrors seller_id).
ALTER TABLE "discount_liability_ledger"
  ADD COLUMN IF NOT EXISTS "franchise_id" TEXT,
  ADD COLUMN IF NOT EXISTS "brand_id" TEXT;

CREATE INDEX IF NOT EXISTS "discount_liability_ledger_franchise_id_idx"
  ON "discount_liability_ledger" ("franchise_id");
CREATE INDEX IF NOT EXISTS "discount_liability_ledger_brand_id_idx"
  ON "discount_liability_ledger" ("brand_id");
