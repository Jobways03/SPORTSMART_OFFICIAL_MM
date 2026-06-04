-- Phase 165 — Razorpay Integration flow audit remediation.
--
-- #3  payment_webhook_events — durable inbound-webhook idempotency ledger
--     (was Redis-only; a Redis flush within the 24h TTL re-processed events).
-- #5/#6 master_orders failure columns — capture gateway error_code /
--     error_description + the failed payment id from payment.failed (were dropped).
-- #8  partial-unique on master_orders.razorpay_payment_id + payments.provider_payment_id
--     (the razorpay_order_id partial-unique already exists from Phase 66; this
--     closes the payment-id half — two orders can't claim the same captured payment).

-- ── #3 webhook event ledger ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PaymentWebhookProcessingStatus" AS ENUM (
    'PROCESSING', 'PROCESSED', 'FAILED_PERMANENT', 'IGNORED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "id"                  TEXT NOT NULL,
  "provider"            TEXT NOT NULL DEFAULT 'razorpay',
  "event_key"           TEXT NOT NULL,
  "event_type"          TEXT NOT NULL,
  "provider_event_id"   TEXT,
  "provider_payment_id" TEXT,
  "master_order_id"     TEXT,
  "payload_sha256"      TEXT NOT NULL,
  "signature"           TEXT,
  "processing_status"   "PaymentWebhookProcessingStatus" NOT NULL DEFAULT 'PROCESSING',
  "error_message"       TEXT,
  "received_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"        TIMESTAMP(3),
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_event_key_unique"
  ON "payment_webhook_events" ("event_key");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_provider_payment_id_idx"
  ON "payment_webhook_events" ("provider_payment_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_master_order_id_idx"
  ON "payment_webhook_events" ("master_order_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_type_received_idx"
  ON "payment_webhook_events" ("event_type", "received_at" DESC);

-- ── #5/#6 master_orders failure detail ──────────────────────────────
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "last_failed_payment_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "last_payment_failure_code"   TEXT,
  ADD COLUMN IF NOT EXISTS "last_payment_failure_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_payment_failure_at"     TIMESTAMP(3);

-- ── #8 partial-unique on the captured-payment id ────────────────────
-- Defence-in-depth: a single captured Razorpay payment must map to at most
-- one order (mirrors the razorpay_order_id partial-unique from Phase 66).
CREATE UNIQUE INDEX IF NOT EXISTS "master_orders_razorpay_payment_id_unique"
  ON "master_orders" ("razorpay_payment_id")
  WHERE "razorpay_payment_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_payment_id_unique"
  ON "payments" ("provider_payment_id")
  WHERE "provider_payment_id" IS NOT NULL;
