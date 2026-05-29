-- Phase 81 (2026-05-22) — sub-order cancel audit Gaps #2/#3/#6/#20.
--
-- 1. New CancellationSource enum + cancellation audit columns on
--    SubOrder so the cancel-action audit trail lives on the row,
--    not just in the best-effort event payload (Gap #2/#3).
-- 2. New PARTIALLY_CANCELLED value on OrderStatus enum so a master
--    with some-but-not-all sub-orders cancelled has a queryable
--    status instead of staying as ROUTED_TO_SELLER / etc. (Gap #6/#20).
-- 3. FK from sub_orders.cancelled_by → admins on Cascade SET NULL so
--    admin deletion doesn't destroy the historical audit (Gap #3).
-- 4. Analytics indexes for "cancels by admin X" + "cancels by source"
--    dashboard queries.

-- ── 1. CancellationSource enum + columns ───────────────────────
CREATE TYPE "CancellationSource" AS ENUM ('ADMIN', 'CUSTOMER', 'SYSTEM');

ALTER TABLE "sub_orders"
  ADD COLUMN "cancelled_at"        TIMESTAMP(3),
  ADD COLUMN "cancelled_by"        TEXT,
  ADD COLUMN "cancel_reason"       TEXT,
  ADD COLUMN "cancellation_source" "CancellationSource";

-- Backfill best-effort: existing rows in fulfillment_status='CANCELLED'
-- get cancelled_at = updated_at + cancellation_source = ADMIN. This is
-- a heuristic — the actual cancel time is lost for pre-Phase-81 rows.
UPDATE "sub_orders"
SET "cancelled_at"       = "updated_at",
    "cancellation_source" = 'ADMIN'::"CancellationSource"
WHERE "fulfillment_status" = 'CANCELLED' AND "cancelled_at" IS NULL;

-- ── 2. FK to admins ────────────────────────────────────────────
ALTER TABLE "sub_orders"
  ADD CONSTRAINT "sub_orders_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by") REFERENCES "admins"("id")
  ON DELETE SET NULL;

-- ── 3. PARTIALLY_CANCELLED on OrderStatus ──────────────────────
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_CANCELLED';

-- ── 4. Analytics indexes ───────────────────────────────────────
CREATE INDEX "sub_orders_cancellation_source_cancelled_at_idx"
  ON "sub_orders" ("cancellation_source", "cancelled_at");
CREATE INDEX "sub_orders_cancelled_by_cancelled_at_idx"
  ON "sub_orders" ("cancelled_by", "cancelled_at");
