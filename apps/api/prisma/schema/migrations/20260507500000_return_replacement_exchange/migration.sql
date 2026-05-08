-- Phase 13 (P1.14) — replacement / exchange flow foundation.
--
-- A return can resolve to a replacement (same SKU shipped at ₹0) or
-- exchange (different SKU; price-diff handled per priceDiffMode).
-- This migration only lays the foundation: schema columns + new
-- enum values + index. Actual order creation lives in a follow-up
-- (needs Order/checkout integration for payment collection on
-- COLLECT_FROM_CUSTOMER cases).
--
-- The new CustomerRemedy values are additive — disputes never write
-- them (DTO union stays narrow), so existing dispute behaviour is
-- unchanged. Returns are the only writer.

-- 1. Extend the CustomerRemedy enum (additive — backward compatible).
ALTER TYPE "CustomerRemedy" ADD VALUE IF NOT EXISTS 'REPLACEMENT';
ALTER TYPE "CustomerRemedy" ADD VALUE IF NOT EXISTS 'EXCHANGE';

-- 2. New enum tracking the lifecycle of the replacement/exchange
--    request from QC-approve through fulfilment.
CREATE TYPE "ReplacementRequestStatus" AS ENUM (
  'NONE',                  -- no replacement requested (default)
  'PENDING_STOCK_CHECK',   -- QC said REPLACEMENT/EXCHANGE; awaiting inventory check
  'AWAITING_PAYMENT',      -- exchange with COLLECT_FROM_CUSTOMER price-diff
  'AWAITING_FULFILMENT',   -- order created, courier hand-off pending
  'FULFILLED',             -- replacement order shipped + delivered
  'CANCELLED',              -- customer pulled out / stock unavailable / etc.
  'FALLBACK_TO_REFUND'     -- stock unavailable / customer declined diff → flipped to refund
);

-- 3. Columns on `returns`. Three string FKs (replacement order, exchange
--    order, target variant) and the lifecycle status. orderId references
--    are loose (no FK constraint) until the Order module's PR lands —
--    keeps the migration deployable today; FK enforcement is added in
--    the follow-up that implements actual order creation.
ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "replacement_status"        "ReplacementRequestStatus",
  ADD COLUMN IF NOT EXISTS "replacement_order_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "exchange_order_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "exchange_target_variant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "exchange_price_diff_paise"  BIGINT;

CREATE INDEX IF NOT EXISTS "returns_replacement_status_idx"
  ON "returns" ("replacement_status");
