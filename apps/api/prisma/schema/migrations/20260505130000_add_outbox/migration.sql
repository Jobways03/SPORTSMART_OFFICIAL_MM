-- Phase 2 — Transactional Outbox (ADR-008).
-- See docs/decisions/008-transactional-outbox.md and the outbox runbook
-- before changing this migration.

-- CreateEnum
CREATE TYPE "OutboxEventState" AS ENUM ('PENDING', 'PUBLISHED');

-- CreateTable: outbox_events
CREATE TABLE "outbox_events" (
    "id"              TEXT NOT NULL,
    "event_name"      TEXT NOT NULL,
    "aggregate"       TEXT NOT NULL,
    "aggregate_id"    TEXT NOT NULL,
    "payload"         JSONB NOT NULL,
    "occurred_at"     TIMESTAMP(3) NOT NULL,
    "state"           "OutboxEventState" NOT NULL DEFAULT 'PENDING',
    "published_at"    TIMESTAMP(3),
    "attempts"        INTEGER NOT NULL DEFAULT 0,
    "last_error"      TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_events_state_next_attempt_at_idx"
  ON "outbox_events"("state", "next_attempt_at");
CREATE INDEX "outbox_events_aggregate_aggregate_id_idx"
  ON "outbox_events"("aggregate", "aggregate_id");
CREATE INDEX "outbox_events_created_at_idx"
  ON "outbox_events"("created_at");

-- CreateTable: outbox_dead_letters
CREATE TABLE "outbox_dead_letters" (
    "id"              TEXT NOT NULL,
    "outbox_event_id" TEXT NOT NULL,
    "event_name"      TEXT NOT NULL,
    "aggregate"       TEXT NOT NULL,
    "aggregate_id"    TEXT NOT NULL,
    "payload"         JSONB NOT NULL,
    "failure_reason"  TEXT NOT NULL,
    "attempts"        INTEGER NOT NULL,
    "dead_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_dead_letters_event_name_dead_at_idx"
  ON "outbox_dead_letters"("event_name", "dead_at");
CREATE INDEX "outbox_dead_letters_aggregate_aggregate_id_idx"
  ON "outbox_dead_letters"("aggregate", "aggregate_id");

-- CreateTable: event_deduplication
CREATE TABLE "event_deduplication" (
    "event_id"    TEXT NOT NULL,
    "handler"     TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deduplication_pkey" PRIMARY KEY ("event_id", "handler")
);

CREATE INDEX "event_deduplication_handler_consumed_at_idx"
  ON "event_deduplication"("handler", "consumed_at");
