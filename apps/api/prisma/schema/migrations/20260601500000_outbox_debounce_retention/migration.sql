-- Phase 186 — Notification Outbox Publisher Cron audit remediation.
--
-- Adds (additively, no destructive reshape) to the transactional
-- domain-event outbox (ADR-008):
--   #1  debounce: dedupe_key + debounce_until (+ partial-unique for atomic merge)
--   #5  scheduled_at for future-dated delivery
--   #7  RETRYING enum state (events in backoff, queryable)
--   #16 correlation_id + causation_id for distributed tracing
--   #9/#15 a payload-size CHECK backstop (service layer also caps writes)
--
-- ALTER TYPE ... ADD VALUE is non-destructive and the new value is NOT used
-- in INSERT/UPDATE within this migration (the partial index below keys only
-- on the pre-existing 'PENDING' value), so it is safe under PG 12+
-- transactional execution.

ALTER TYPE "OutboxEventState" ADD VALUE IF NOT EXISTS 'RETRYING';

ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT,
  ADD COLUMN IF NOT EXISTS "debounce_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "correlation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "causation_id" TEXT;

-- (#1) Debounce-merge lookup + (#16) trace correlation.
CREATE INDEX IF NOT EXISTS "outbox_events_dedupe_key_idx"
  ON "outbox_events" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "outbox_events_correlation_id_idx"
  ON "outbox_events" ("correlation_id");

-- (#1) Partial UNIQUE index so the debounce merge can use INSERT … ON
-- CONFLICT atomically: at most one un-published row per dedupe_key. Keyed
-- ONLY on the pre-existing 'PENDING' state to keep this migration safe
-- w.r.t. the just-added RETRYING enum value, and because debounce only
-- collapses not-yet-attempted rows (a RETRYING row already fired once).
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_dedupe_key_pending_uq"
  ON "outbox_events" ("dedupe_key")
  WHERE "state" = 'PENDING' AND "dedupe_key" IS NOT NULL;

-- (#9/#15) Hard backstop on payload size. Generous 1 MB ceiling so it never
-- rejects a legitimate domain event (the service layer enforces a tighter,
-- configurable cap); NOT VALID so pre-existing rows are not retro-checked.
ALTER TABLE "outbox_events"
  DROP CONSTRAINT IF EXISTS "outbox_events_payload_size_chk";
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_payload_size_chk"
  CHECK (octet_length("payload"::text) < 1048576) NOT VALID;
