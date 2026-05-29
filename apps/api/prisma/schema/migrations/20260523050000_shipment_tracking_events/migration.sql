-- Phase 86 (2026-05-23) — tracking webhook audit Gaps #1, #17.
--
-- Persistent per-scan history of carrier tracking events. One row
-- per accepted scan (webhook or polling-cron) so the customer
-- track-your-order page can render the full "Picked up Mumbai →
-- In Transit Pune → Out for Delivery Bangalore → Delivered"
-- chronology, and operations can investigate "when did this
-- shipment hit each milestone?".
--
-- Idempotency at the DB layer via (sub_order_id, external_status,
-- scan_at) UNIQUE. The Phase 83 WebhookEvent table dedups at the
-- webhook envelope; this table dedups at the scan level so a poll-
-- cron observation of the same scan iThink already pushed doesn't
-- double-insert.

CREATE TABLE "shipment_tracking_events" (
  "id"                  TEXT      PRIMARY KEY,
  "sub_order_id"        TEXT      NOT NULL,
  "internal_status"     TEXT      NOT NULL,
  "external_status"     TEXT      NOT NULL,
  "external_status_code" TEXT,
  "scan_location"       TEXT,
  "remarks"             TEXT,
  "scan_at"             TIMESTAMP(3) NOT NULL,
  "received_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source"              TEXT      NOT NULL,
  "raw_payload"         JSONB,

  CONSTRAINT "shipment_tracking_events_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "shipment_tracking_events_sub_order_id_external_status_scan_at_key"
  ON "shipment_tracking_events" ("sub_order_id", "external_status", "scan_at");
CREATE INDEX "shipment_tracking_events_sub_order_id_scan_at_idx"
  ON "shipment_tracking_events" ("sub_order_id", "scan_at" DESC);
CREATE INDEX "shipment_tracking_events_internal_status_scan_at_idx"
  ON "shipment_tracking_events" ("internal_status", "scan_at");
