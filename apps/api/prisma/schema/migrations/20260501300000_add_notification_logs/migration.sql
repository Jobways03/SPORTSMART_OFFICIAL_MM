-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'RETRY');

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "recipient_id" TEXT,
    "destination" TEXT NOT NULL,
    "template_key" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "event_type" TEXT,
    "event_id" TEXT,
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_logs_recipient_id_created_at_idx" ON "notification_logs"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_event_type_event_id_idx" ON "notification_logs"("event_type", "event_id");

-- CreateIndex
CREATE INDEX "notification_logs_channel_status_created_at_idx" ON "notification_logs"("channel", "status", "created_at" DESC);
