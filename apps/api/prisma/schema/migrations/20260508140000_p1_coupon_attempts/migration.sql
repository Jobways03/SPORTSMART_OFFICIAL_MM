-- Phase E (P1.4) — Coupon attempt tracking + fraud controls.
--
-- Every call to POST /customer/coupons/validate writes one row here
-- (regardless of outcome), so we can:
--   1. Rate-limit by customer + IP using a sliding window over the
--      last N attempts.
--   2. Detect coupon-code guessing spikes (many INVALID attempts
--      from one source over a short window).
--   3. Surface the top-attempted invalid codes on the admin abuse
--      panel so ops can blocklist obvious guessing patterns.
--
-- Indexes are aimed at the read patterns we need:
--   (customer_id, created_at) — sliding window per customer
--   (ip_address, created_at)  — sliding window per IP
--   (result, created_at)      — admin dashboard counts
--   (code_attempted)          — top-attempted codes report

CREATE TYPE "CouponAttemptResult" AS ENUM (
  'VALID',
  'INVALID',
  'EXPIRED',
  'NOT_ELIGIBLE',
  'BLOCKED'
);

CREATE TABLE "coupon_attempts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "ip_address" TEXT,
    "device_id" TEXT,
    "code_attempted" TEXT NOT NULL,
    "result" "CouponAttemptResult" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coupon_attempts_customer_id_created_at_idx"
  ON "coupon_attempts"("customer_id", "created_at");
CREATE INDEX "coupon_attempts_ip_address_created_at_idx"
  ON "coupon_attempts"("ip_address", "created_at");
CREATE INDEX "coupon_attempts_result_created_at_idx"
  ON "coupon_attempts"("result", "created_at");
CREATE INDEX "coupon_attempts_code_attempted_idx"
  ON "coupon_attempts"("code_attempted");
