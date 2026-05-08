-- ============================================
-- Phase 7 (PR 7.4) — Data erasure (GDPR) requests
-- ============================================

CREATE TYPE "ErasureSubjectType" AS ENUM ('USER', 'SELLER', 'AFFILIATE', 'FRANCHISE');
CREATE TYPE "ErasureStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

CREATE TABLE "data_erasure_requests" (
    "id"                       TEXT                NOT NULL,
    "subject_type"             "ErasureSubjectType" NOT NULL,
    "subject_id"               TEXT                NOT NULL,
    "subject_email_snapshot"   TEXT,
    "status"                   "ErasureStatus"     NOT NULL DEFAULT 'PENDING',
    "source"                   TEXT                NOT NULL DEFAULT 'USER_REQUEST',
    "requested_by_actor_type"  TEXT,
    "requested_by_actor_id"    TEXT,
    "not_before"               TIMESTAMP(3)        NOT NULL,
    "processing_started_at"    TIMESTAMP(3),
    "completed_at"             TIMESTAMP(3),
    "outcome"                  JSONB,
    "created_at"               TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3)        NOT NULL,
    CONSTRAINT "data_erasure_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_erasure_requests_status_not_before_idx"
    ON "data_erasure_requests" ("status", "not_before");

CREATE INDEX "data_erasure_requests_subject_type_subject_id_idx"
    ON "data_erasure_requests" ("subject_type", "subject_id");
