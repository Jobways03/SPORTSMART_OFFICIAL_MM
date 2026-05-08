-- Phase 13 (P1.14 follow-up) — Razorpay payment for EXCHANGE
-- COLLECT_FROM_CUSTOMER. When the target SKU is pricier the
-- customer must settle the diff before fulfilment; this column
-- stores the Razorpay order id minted to track that payment.
-- Razorpay payment id + signature are passed in transient and
-- aren't persisted on the return (they live on the wallet/payment
-- attempt log, same as the rest of checkout).

ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "exchange_razorpay_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "exchange_payment_completed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "returns_exchange_razorpay_order_id_idx"
  ON "returns" ("exchange_razorpay_order_id")
  WHERE "exchange_razorpay_order_id" IS NOT NULL;
