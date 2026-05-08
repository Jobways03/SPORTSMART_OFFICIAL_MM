-- ============================================
-- Phase 8 (PR 8.3) — Cron observability
-- ============================================

CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'TIMEOUT');

CREATE TABLE "cron_runs" (
    "id"           TEXT             NOT NULL,
    "job_name"     TEXT             NOT NULL,
    "started_at"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at"  TIMESTAMP(3),
    "status"       "CronRunStatus"  NOT NULL DEFAULT 'RUNNING',
    "duration_ms"  INTEGER,
    "error"        TEXT,
    "result"       JSONB,
    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cron_runs_job_name_started_at_idx"
    ON "cron_runs" ("job_name", "started_at");

CREATE INDEX "cron_runs_status_started_at_idx"
    ON "cron_runs" ("status", "started_at");

CREATE TABLE "cron_heartbeat_targets" (
    "job_name"                    TEXT         NOT NULL,
    "expected_interval_seconds"   INTEGER      NOT NULL,
    "tolerance_multiplier"        INTEGER      NOT NULL DEFAULT 3,
    "enabled"                     BOOLEAN      NOT NULL DEFAULT true,
    "description"                 TEXT,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cron_heartbeat_targets_pkey" PRIMARY KEY ("job_name")
);
