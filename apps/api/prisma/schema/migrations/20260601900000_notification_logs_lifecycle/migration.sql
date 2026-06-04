-- Phase 190 — Notification Logs flow audit remediation.
--
-- #2  status lifecycle: + PROCESSING, DEAD_LETTERED (DELIVERED/CANCELLED/
--     RETRYING/PENDING already added in Phase 185).
-- #5  providerResponseSummary + provider columns.
-- #6  NotificationFailureCode enum + failure_code column.
-- #7  failed_at timestamp (deliveredAt added in Phase 185).
-- #4  outbox_event_id + parent_log_id soft-link columns.

ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTERED';

CREATE TYPE "NotificationFailureCode" AS ENUM (
  'INVALID_EMAIL', 'INVALID_PHONE', 'BOUNCED', 'SPAM_COMPLAINT', 'RATE_LIMITED',
  'PROVIDER_ERROR', 'AUTH_FAILED', 'NETWORK_TIMEOUT', 'BLOCKED_BY_SUPPRESSION',
  'BLOCKED_BY_PREFERENCE', 'MALFORMED_TEMPLATE', 'NOT_CONFIGURED', 'UNKNOWN'
);

ALTER TABLE "notification_logs"
  ADD COLUMN IF NOT EXISTS "provider_response_summary" JSONB,
  ADD COLUMN IF NOT EXISTS "failure_code" "NotificationFailureCode",
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "outbox_event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "parent_log_id" TEXT,
  ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "notification_logs_failure_code_idx"
  ON "notification_logs" ("failure_code");
CREATE INDEX IF NOT EXISTS "notification_logs_outbox_event_id_idx"
  ON "notification_logs" ("outbox_event_id");
CREATE INDEX IF NOT EXISTS "notification_logs_parent_log_id_idx"
  ON "notification_logs" ("parent_log_id");
