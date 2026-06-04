-- Phase 243-248 — Discount campaign-creation governance + liability snapshot
-- + storefront-content hardening. Additive: every column is nullable or has a
-- default, every enum value is appended; no destructive change. Safe to apply
-- on a populated DB without backfill.

-- ── #243 (campaign creation) — DiscountStatus lifecycle states ──────────────
-- PAUSED (resumable disable), ARCHIVED (soft-remove), SUSPENDED_FOR_ABUSE
-- (#245 risk kill). ADD VALUE IF NOT EXISTS is idempotent.
ALTER TYPE "DiscountStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "DiscountStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
ALTER TYPE "DiscountStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED_FOR_ABUSE';

-- ── #243 — actor attribution + OCC + PERCENT cap + storefront copy ──────────
ALTER TABLE "discounts"
  ADD COLUMN IF NOT EXISTS "created_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "max_discount_amount_in_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "description_long" TEXT;

-- ── #247 (liability) — immutable funding-config snapshot per order row ──────
ALTER TABLE "order_discounts"
  ADD COLUMN IF NOT EXISTS "funding_config_json" JSONB;

-- ── #247 — currency tag + settlement-cycle linkage (revive SETTLED lifecycle)
ALTER TABLE "discount_liability_ledger"
  ADD COLUMN IF NOT EXISTS "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "settlement_cycle_id" TEXT;

CREATE INDEX IF NOT EXISTS "discount_liability_ledger_settlement_cycle_id_idx"
  ON "discount_liability_ledger" ("settlement_cycle_id");

-- ── #244 (coupon codes) — affiliate-coupon revocation provenance ────────────
ALTER TABLE "affiliate_coupon_codes"
  ADD COLUMN IF NOT EXISTS "revoked_by_admin_id" TEXT,
  ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revocation_reason" TEXT;

-- ── #248 (storefront slots) — device-targeted media + OCC version ───────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StorefrontDeviceVisibility') THEN
    CREATE TYPE "StorefrontDeviceVisibility" AS ENUM ('ALL', 'DESKTOP_ONLY', 'MOBILE_ONLY');
  END IF;
END$$;

ALTER TABLE "storefront_content_blocks"
  ADD COLUMN IF NOT EXISTS "image_url_mobile" TEXT,
  ADD COLUMN IF NOT EXISTS "device_visibility" "StorefrontDeviceVisibility" NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
