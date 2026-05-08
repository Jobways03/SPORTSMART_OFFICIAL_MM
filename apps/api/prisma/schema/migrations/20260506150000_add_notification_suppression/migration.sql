-- ============================================
-- Phase 8 (PR 8.2) — Notification suppression list
-- ============================================

CREATE TABLE "notification_suppressions" (
    "id"          TEXT                  NOT NULL,
    "channel"     "NotificationChannel" NOT NULL,
    "destination" TEXT                  NOT NULL,
    "reason"      TEXT                  NOT NULL,
    "expires_at"  TIMESTAMP(3),
    "added_by"    TEXT,
    "created_at"  TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)          NOT NULL,
    CONSTRAINT "notification_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_suppressions_channel_destination_key"
    ON "notification_suppressions" ("channel", "destination");

CREATE INDEX "notification_suppressions_destination_idx"
    ON "notification_suppressions" ("destination");

CREATE INDEX "notification_suppressions_expires_at_idx"
    ON "notification_suppressions" ("expires_at");
