-- Phase 83 (2026-05-23) — delivery confirmation audit Gaps #2/#3/#8/#11/#13.
--
-- 1. DeliveryConfirmationSource enum + audit columns on SubOrder
--    (Gap #3, #11). Webhook vs admin manual is now persistently
--    distinguishable.
-- 2. commission_lock_scheduled_at column on SubOrder (Gap #2).
--    Polling cron switches from "find delivered + past
--    return-window" to "WHERE commission_lock_scheduled_at <= now()
--    AND commission_processed = false" so commission locks
--    immediately when the scheduled time passes.
-- 3. PARTIALLY_DELIVERED on OrderStatus enum (Flow #63 carry).
-- 4. WebhookEvent table (Gap #8) for persistent raw payload log.
-- 5. Backfill commission_lock_scheduled_at = return_window_ends_at
--    for existing DELIVERED-but-not-processed rows so the polling
--    cron picks them up without a code change.

-- ── 1. DeliveryConfirmationSource enum + columns ───────────────
CREATE TYPE "DeliveryConfirmationSource" AS ENUM (
  'WEBHOOK_SHIPROCKET',
  'WEBHOOK_ITHINK',
  'MANUAL_ADMIN',
  'MANUAL_FRANCHISE'
);

ALTER TABLE "sub_orders"
  ADD COLUMN "delivered_by"                   TEXT,
  ADD COLUMN "delivery_source"                "DeliveryConfirmationSource",
  ADD COLUMN "delivery_proof_url"             TEXT,
  ADD COLUMN "delivery_otp_verified"          BOOLEAN,
  ADD COLUMN "delivery_signature_url"         TEXT,
  ADD COLUMN "commission_lock_scheduled_at"   TIMESTAMP(3);

-- Backfill: legacy DELIVERED rows get commission_lock_scheduled_at
-- = return_window_ends_at so the polling cron picks them up
-- automatically. Without this the cron would have to keep its
-- legacy "filter by return window expired" query alongside the new
-- column-based query.
UPDATE "sub_orders"
SET "commission_lock_scheduled_at" = "return_window_ends_at"
WHERE "fulfillment_status" = 'DELIVERED'
  AND "commission_processed" = false
  AND "return_window_ends_at" IS NOT NULL
  AND "commission_lock_scheduled_at" IS NULL;

-- Tag historic DELIVERED rows with MANUAL_ADMIN as the best-effort
-- source guess. New rows write the correct enum value.
UPDATE "sub_orders"
SET "delivery_source" = 'MANUAL_ADMIN'::"DeliveryConfirmationSource"
WHERE "fulfillment_status" = 'DELIVERED' AND "delivery_source" IS NULL;

-- ── 2. PARTIALLY_DELIVERED on OrderStatus ──────────────────────
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_DELIVERED';

-- ── 3. Indexes ─────────────────────────────────────────────────
CREATE INDEX "sub_orders_commission_lock_scheduled_at_idx"
  ON "sub_orders" ("commission_lock_scheduled_at");
CREATE INDEX "sub_orders_delivery_source_delivered_at_idx"
  ON "sub_orders" ("delivery_source", "delivered_at");

-- ── 4. WebhookEvent table ──────────────────────────────────────
CREATE TABLE "webhook_events" (
  "id"                TEXT      PRIMARY KEY,
  "provider"          TEXT      NOT NULL,
  "event_key"         TEXT      NOT NULL,
  "awb"               TEXT,
  "status"            TEXT,
  "raw_payload"       JSONB     NOT NULL,
  "signature_valid"   BOOLEAN   NOT NULL,
  "received_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"      TIMESTAMP(3),
  "process_outcome"   TEXT,
  "error_message"     TEXT,
  "sub_order_id"      TEXT
);

CREATE UNIQUE INDEX "webhook_events_provider_event_key_unique"
  ON "webhook_events" ("provider", "event_key");
CREATE INDEX "webhook_events_awb_received_at_idx"
  ON "webhook_events" ("awb", "received_at" DESC);
CREATE INDEX "webhook_events_sub_order_id_idx"
  ON "webhook_events" ("sub_order_id");
CREATE INDEX "webhook_events_process_outcome_received_at_idx"
  ON "webhook_events" ("process_outcome", "received_at");
