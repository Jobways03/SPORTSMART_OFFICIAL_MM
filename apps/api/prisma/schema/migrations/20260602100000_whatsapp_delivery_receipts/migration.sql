-- Phase 191 — WhatsApp Webhook flow audit remediation.
--
-- #1  WhatsappStatus delivery-receipt table (+ idempotency unique).
-- #3  media columns + (#14) reply-context + (#5) contact/customer + (#12) waba.
-- #6  payload-size CHECK backstops on both inbound + status tables.

CREATE TYPE "WhatsappDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

ALTER TABLE "whatsapp_inbound"
  ADD COLUMN IF NOT EXISTS "media_id" TEXT,
  ADD COLUMN IF NOT EXISTS "media_mime_type" TEXT,
  ADD COLUMN IF NOT EXISTS "replied_to_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "waba_id" TEXT;

CREATE INDEX IF NOT EXISTS "whatsapp_inbound_customer_id_received_at_idx"
  ON "whatsapp_inbound" ("customer_id", "received_at" DESC);

-- (#6) payload-size backstop (generous 100 KB per message).
ALTER TABLE "whatsapp_inbound"
  DROP CONSTRAINT IF EXISTS "whatsapp_inbound_payload_size_chk";
ALTER TABLE "whatsapp_inbound"
  ADD CONSTRAINT "whatsapp_inbound_payload_size_chk"
  CHECK (octet_length("raw_payload"::text) < 100000) NOT VALID;

CREATE TABLE IF NOT EXISTS "whatsapp_statuses" (
  "id" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "status" "WhatsappDeliveryStatus" NOT NULL,
  "recipient_id" TEXT,
  "error_code" TEXT,
  "error_title" TEXT,
  "waba_id" TEXT,
  "raw_payload" JSONB NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_statuses_provider_message_id_status_key"
  ON "whatsapp_statuses" ("provider_message_id", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_statuses_provider_message_id_idx"
  ON "whatsapp_statuses" ("provider_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_statuses_received_at_idx"
  ON "whatsapp_statuses" ("received_at" DESC);

ALTER TABLE "whatsapp_statuses"
  ADD CONSTRAINT "whatsapp_statuses_payload_size_chk"
  CHECK (octet_length("raw_payload"::text) < 100000) NOT VALID;
