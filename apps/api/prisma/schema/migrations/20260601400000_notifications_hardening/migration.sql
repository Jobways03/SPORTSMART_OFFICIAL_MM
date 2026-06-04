-- Phase 185 — Template-Based Notifications flow audit remediation.
--
-- 1. (#5) Extend NotificationStatus with the lifecycle states the spec
--    requires: PENDING (pre-queue), DELIVERED (carrier receipt), RETRYING
--    (in-flight retry), CANCELLED (admin-cancelled before delivery).
-- 2. (#4) DLT (TRAI) registration ids on templates so SMS sends can be
--    gated on regulatory compliance.
-- 3. (#6) variablesSchema — declared expected vars per template.
-- 4. (#14) customerVisibleOnly — strip internal payload fields at render.
-- 5. (#17) triggerSource + (#5) deliveredAt on the log.
--
-- ALTER TYPE ... ADD VALUE is non-destructive and these values are not
-- referenced (in INSERT/UPDATE) within this same migration, so it is safe
-- under Postgres 12+ transactional migration execution.

ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'RETRYING';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- (#4 / #6 / #14) NotificationTemplate columns.
ALTER TABLE "notification_templates"
  ADD COLUMN IF NOT EXISTS "dlt_template_id" TEXT,
  ADD COLUMN IF NOT EXISTS "dlt_header_id" TEXT,
  ADD COLUMN IF NOT EXISTS "variables_schema" JSONB,
  ADD COLUMN IF NOT EXISTS "customer_visible_only" BOOLEAN NOT NULL DEFAULT true;

-- (#17 / #5) NotificationLog columns.
ALTER TABLE "notification_logs"
  ADD COLUMN IF NOT EXISTS "trigger_source" TEXT,
  ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);

-- (#5) Delivery-receipt webhooks resolve the row by the provider message id.
CREATE INDEX IF NOT EXISTS "notification_logs_provider_message_id_idx"
  ON "notification_logs" ("provider_message_id");
