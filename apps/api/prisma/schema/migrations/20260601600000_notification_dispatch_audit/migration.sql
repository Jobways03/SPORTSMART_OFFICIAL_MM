-- Phase 187 — Admin Notification Dispatch flow audit remediation.
--
-- Adds the dispatch audit trail the spec requires (#3 actor, #4 bypass
-- reason/alertType, #7 dedicated table, #8 idempotency via unique eventId).
-- The RBAC split (#1/#2/#5/#6) was already delivered in Phase 185; this
-- migration is the schema half of the raw-path compliance hardening.

CREATE TYPE "DispatchPath" AS ENUM ('TEMPLATE', 'RAW');

CREATE TYPE "AdminDispatchAlertType" AS ENUM (
  'ACCOUNT_SECURITY', 'FRAUD_ALERT', 'COMPLIANCE_NOTICE', 'CRITICAL_SERVICE'
);

CREATE TYPE "NotificationDispatchStatus" AS ENUM ('ENQUEUED', 'SUPPRESSED', 'FAILED');

CREATE TABLE "notification_dispatches" (
  "id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "dispatched_by_admin_id" TEXT NOT NULL,
  "dispatch_path" "DispatchPath" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "template_key" TEXT,
  "event_class" TEXT,
  "raw_subject" TEXT,
  "raw_body" TEXT,
  "recipient_id" TEXT,
  "destination" TEXT,
  "bypass_opt_out" BOOLEAN NOT NULL DEFAULT false,
  "bypass_reason" TEXT,
  "alert_type" "AdminDispatchAlertType",
  "job_id" TEXT,
  "status" "NotificationDispatchStatus" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("id")
);

-- (#8) Idempotency: one dispatch per eventId.
CREATE UNIQUE INDEX "notification_dispatches_event_id_key"
  ON "notification_dispatches" ("event_id");

CREATE INDEX "notification_dispatches_dispatched_by_admin_id_created_at_idx"
  ON "notification_dispatches" ("dispatched_by_admin_id", "created_at" DESC);
CREATE INDEX "notification_dispatches_recipient_id_created_at_idx"
  ON "notification_dispatches" ("recipient_id", "created_at" DESC);
CREATE INDEX "notification_dispatches_dispatch_path_created_at_idx"
  ON "notification_dispatches" ("dispatch_path", "created_at" DESC);
