-- Phase 87 (2026-05-23) — NDR/RTO lifecycle persistence.
--
-- Gap #4/#5/#6/#10/#11/#19. Adds NDR + RTO columns on sub_orders so
-- multi-failed-delivery sub-orders are observable + the RTO phase
-- is rendered to customers. New ndr_attempts / rto_events history
-- tables for forensics + per-attempt detail. rto_credit_note_pending
-- shadow table queues GST credit-note obligations for finance.
-- Depends on 20260523065000_shipment_status_exception which adds
-- EXCEPTION to the enum (separate migration because Postgres
-- prohibits ALTER TYPE ADD VALUE inside the same tx as other DDL).

-- 1. SubOrder NDR/RTO columns.
ALTER TABLE "sub_orders"
  ADD COLUMN "ndr_attempt_count"   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN "ndr_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "ndr_last_reason"     TEXT,
  ADD COLUMN "ndr_last_reason_code" TEXT,
  ADD COLUMN "ndr_status"          TEXT,
  ADD COLUMN "rto_initiated_at"    TIMESTAMP(3),
  ADD COLUMN "rto_in_transit_at"   TIMESTAMP(3),
  ADD COLUMN "rto_delivered_at"    TIMESTAMP(3),
  ADD COLUMN "rto_reason"          TEXT,
  ADD COLUMN "last_courier_status" TEXT,
  ADD COLUMN "last_courier_reason_code" TEXT;

-- 2. ndr_attempts — per-NDR-scan history.
CREATE TABLE "ndr_attempts" (
  "id"               TEXT        PRIMARY KEY,
  "sub_order_id"     TEXT        NOT NULL,
  "attempt_number"   INTEGER     NOT NULL,
  "attempted_at"     TIMESTAMP(3) NOT NULL,
  "reason_code"      TEXT,
  "reason"           TEXT,
  "scan_location"    TEXT,
  "carrier_event_id" TEXT,
  "raw_payload"      JSONB,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ndr_attempts_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id")
    REFERENCES "sub_orders"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX "ndr_attempts_sub_order_id_attempt_number_key"
  ON "ndr_attempts" ("sub_order_id", "attempt_number");

CREATE UNIQUE INDEX "ndr_attempts_carrier_event_id_key"
  ON "ndr_attempts" ("carrier_event_id")
  WHERE "carrier_event_id" IS NOT NULL;

CREATE INDEX "ndr_attempts_sub_order_id_attempted_at_idx"
  ON "ndr_attempts" ("sub_order_id", "attempted_at" DESC);

-- 3. rto_events — RTO milestone history.
CREATE TABLE "rto_events" (
  "id"               TEXT        PRIMARY KEY,
  "sub_order_id"     TEXT        NOT NULL,
  "status"           "shipment_internal_status_enum" NOT NULL,
  "occurred_at"      TIMESTAMP(3) NOT NULL,
  "reason"           TEXT,
  "scan_location"    TEXT,
  "carrier_event_id" TEXT,
  "raw_payload"      JSONB,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rto_events_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id")
    REFERENCES "sub_orders"("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX "rto_events_carrier_event_id_key"
  ON "rto_events" ("carrier_event_id")
  WHERE "carrier_event_id" IS NOT NULL;

CREATE INDEX "rto_events_sub_order_id_occurred_at_idx"
  ON "rto_events" ("sub_order_id", "occurred_at" DESC);

-- 4. rto_credit_note_pending — finance-side queue for GST credit
--    notes that RTO_DELIVERED creates. One row per sub-order.
CREATE TABLE "rto_credit_note_pending" (
  "id"                     TEXT        PRIMARY KEY,
  "sub_order_id"           TEXT        NOT NULL,
  "master_order_id"        TEXT        NOT NULL,
  "taxable_amount_in_paise" BIGINT     NOT NULL DEFAULT 0,
  "total_tax_in_paise"     BIGINT      NOT NULL DEFAULT 0,
  "status"                 TEXT        NOT NULL DEFAULT 'PENDING',
  "issued_at"              TIMESTAMP(3),
  "issued_by"              TEXT,
  "notes"                  TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "rto_credit_note_pending_sub_order_id_key"
  ON "rto_credit_note_pending" ("sub_order_id");

CREATE INDEX "rto_credit_note_pending_status_created_at_idx"
  ON "rto_credit_note_pending" ("status", "created_at");
