-- Phase 105 (2026-05-23) — Phase 104 audit Gap #11 closure.
--
-- BulkJob: durable record of fan-out operations (bulk approve / close).
-- Investigators can find a batch by actor + timestamp without scraping
-- N per-row audit_logs.

CREATE TYPE "BulkJobKind" AS ENUM (
  'RETURN_APPROVE',
  'RETURN_CLOSE',
  'OTHER'
);

CREATE TYPE "BulkJobStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "bulk_jobs" (
  "id"               TEXT PRIMARY KEY,
  "kind"             "BulkJobKind" NOT NULL,
  "actor_id"         TEXT NOT NULL,
  "actor_role"       TEXT,
  "total_count"      INTEGER NOT NULL,
  "succeeded_count"  INTEGER,
  "failed_count"     INTEGER,
  "status"           "BulkJobStatus" NOT NULL DEFAULT 'PROCESSING',
  "reason"           VARCHAR(500),
  "inputs"           JSONB NOT NULL,
  "results"          JSONB,
  "idempotency_key"  TEXT UNIQUE,
  "started_at"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "completed_at"     TIMESTAMP(3)
);

CREATE INDEX "bulk_jobs_actor_id_started_at_idx"
  ON "bulk_jobs" ("actor_id", "started_at" DESC);
CREATE INDEX "bulk_jobs_status_idx" ON "bulk_jobs" ("status");
CREATE INDEX "bulk_jobs_kind_started_at_idx"
  ON "bulk_jobs" ("kind", "started_at" DESC);
