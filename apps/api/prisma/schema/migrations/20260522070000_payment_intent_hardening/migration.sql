-- Phase 66 (2026-05-22) — payment intent flow hardening.
--
-- 1) OrderPaymentStatus gets CREATED + EXPIRED (audit Gap #11).
--    Pre-Phase-66 the enum only had PENDING / PAID / VOIDED /
--    CANCELLED — no way to distinguish "Razorpay order minted,
--    customer hasn't opened the modal" from PENDING, and no
--    terminal state for "payment window closed". The new payment
--    expiry sweep cron (Phase 66 Gap #18) flips orders to EXPIRED.
ALTER TYPE "OrderPaymentStatus" ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE "OrderPaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- 2) Partial unique index on razorpay_order_id (audit Gap #4).
--    The schema column is nullable so a NULL-allowing unique
--    would block multiple COD/COD-now-online orders from
--    coexisting. The partial index enforces uniqueness only on
--    rows that actually have a razorpay_order_id set —
--    defence-in-depth against a retry-payment race producing
--    two MasterOrders pointing at the same gateway order.
CREATE UNIQUE INDEX IF NOT EXISTS "master_orders_razorpay_order_id_unique"
  ON "master_orders" ("razorpay_order_id")
  WHERE "razorpay_order_id" IS NOT NULL;

-- 3) Index on razorpay_payment_id for orphan-payment recovery
--    (audit Gap #20). PaymentStatusPollerService uses this column
--    to find orders by payment id; without the index it scans the
--    table.
CREATE INDEX IF NOT EXISTS "master_orders_razorpay_payment_id_idx"
  ON "master_orders" ("razorpay_payment_id");

-- 4) Currency column on MasterOrder (audit Gap #21). Pre-Phase-66
--    currency was hard-coded as INR throughout. Adding the column
--    with default='INR' means existing rows backfill automatically;
--    future multi-currency work can vary it.
ALTER TABLE "master_orders"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

-- 5) PaymentAttempt.amount_in_paise widened to BIGINT (audit Gap
--    #22). Int caps at ~21M ₹; bulk B2B orders can exceed it.
ALTER TABLE "payment_attempts"
  ALTER COLUMN "amount_in_paise" TYPE BIGINT;
