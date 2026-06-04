-- Phase 166 — Payment Status Poller flow audit remediation.
--
-- #6 POLL_STATUS PaymentAttemptKind — the poller's orphan-recovery gateway
--    GET now writes to the attempt ledger (was the only gateway interaction
--    that wrote nothing).
-- #7 per-order poll tracking (last_polled_at / poll_attempt_count /
--    last_poll_error) so the poller backs off instead of polling the same
--    order ~30× over the 30-min window.
-- #8 partial index backing the orphan-recovery predicate (the existing
--    [order_status, payment_expires_at] index serves the cancel path's
--    `payment_expires_at < now`, not this path's `>= now` + NULL semantics).

-- #6 — enum value (PG 12+ allows ADD VALUE in a tx as long as it isn't used
-- in the same tx; we only declare it here).
ALTER TYPE "PaymentAttemptKind" ADD VALUE IF NOT EXISTS 'POLL_STATUS';

-- #7 — per-order poll-attempt tracking.
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "last_polled_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "poll_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_poll_error"    TEXT;

-- #8 — orphan-recovery predicate partial index. Narrow + covers the hot
-- `payment_expires_at >= now` range scan only over still-pending, gateway-
-- order-assigned, not-yet-paid orders. Includes last_polled_at so the #7
-- backoff filter (last_polled_at IS NULL OR last_polled_at < cutoff) is served.
CREATE INDEX IF NOT EXISTS "master_orders_orphan_poll_idx"
  ON "master_orders" ("payment_expires_at", "last_polled_at")
  WHERE "order_status" = 'PENDING_PAYMENT'
    AND "razorpay_order_id" IS NOT NULL
    AND "razorpay_payment_id" IS NULL;
