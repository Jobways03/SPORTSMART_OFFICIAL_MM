-- Phase 189 — Customer Notification Preferences flow audit remediation.
--
-- #12 source + #10 updatedByAdminId on the preference row.
-- #9  NotificationPreferenceHistory (GDPR Art.7 demonstrable-consent trail).

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN IF NOT EXISTS "updated_by_admin_id" TEXT;

CREATE TABLE IF NOT EXISTS "notification_preference_history" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "event_class" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "old_enabled" BOOLEAN,
  "new_enabled" BOOLEAN NOT NULL,
  "source" TEXT NOT NULL,
  "updated_by_admin_id" TEXT,
  "bypass_reason" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preference_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notification_preference_history_user_id_occurred_at_idx"
  ON "notification_preference_history" ("user_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "notification_preference_history_event_class_channel_idx"
  ON "notification_preference_history" ("event_class", "channel");
