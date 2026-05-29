-- Phase 159p (2026-05-27) — Franchise Procurement Request Flow audit #12 +
-- audit-trail gap. Append-only transition history for a procurement request:
-- one row per status change (submit/approve/reject/dispatch/receive/settle/
-- cancel) capturing who/when/from/to/reason. Pre-159p only a single
-- `approved_by` column existed, so "who shipped / received / settled this" was
-- unanswerable.

CREATE TABLE IF NOT EXISTS "procurement_request_events" (
  "id" TEXT NOT NULL,
  "procurement_request_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_type" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "procurement_request_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "procurement_request_events_procurement_request_id_created_at_idx"
  ON "procurement_request_events" ("procurement_request_id", "created_at");

ALTER TABLE "procurement_request_events"
  ADD CONSTRAINT "procurement_request_events_procurement_request_id_fkey"
  FOREIGN KEY ("procurement_request_id") REFERENCES "procurement_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
