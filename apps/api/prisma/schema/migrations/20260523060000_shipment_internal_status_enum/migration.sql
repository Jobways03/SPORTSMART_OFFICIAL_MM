-- Phase 86 follow-up (2026-05-23) — Gap #2/#18 closure.
--
-- Promote ShipmentTrackingEvent.internal_status from free-form text
-- to a Postgres enum. Idempotent on the empty-table case (Phase 86's
-- table was just created in 20260523050000 and has no production
-- data yet); a USING cast still backstops the unlikely case where
-- the column was populated between the two migrations.

CREATE TYPE "shipment_internal_status_enum" AS ENUM (
  'CREATED',
  'PICKUP_PENDING',
  'PICKED_UP',
  'MANIFESTED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'UNDELIVERED',
  'FAILED_DELIVERY',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_DELIVERED',
  'LOST',
  'DAMAGED',
  'CANCELLED'
);

-- The composite index on (internal_status, scan_at) must be dropped
-- before the column type change and re-created after (Postgres
-- doesn't allow altering a column type while a non-trivial index
-- still references it).
DROP INDEX IF EXISTS "shipment_tracking_events_internal_status_scan_at_idx";

ALTER TABLE "shipment_tracking_events"
  ALTER COLUMN "internal_status" TYPE "shipment_internal_status_enum"
  USING "internal_status"::"shipment_internal_status_enum";

CREATE INDEX "shipment_tracking_events_internal_status_scan_at_idx"
  ON "shipment_tracking_events" ("internal_status", "scan_at");
