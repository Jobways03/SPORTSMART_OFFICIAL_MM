-- Phase 6 (2026-05-16) — WhatsApp 24h session window + opt-out state.
--
-- Two tables:
--   1. whatsapp_sessions — one row per E.164 phone. Tracks last
--      inbound (for 24h-window decision) and opt-out timestamp.
--   2. whatsapp_inbound  — append-only log of every inbound message
--      Meta forwards. Provides replay/debug + STOP-keyword detection.

CREATE TABLE "whatsapp_sessions" (
    "id"              TEXT NOT NULL,
    "phone_e164"      TEXT NOT NULL,
    "customer_id"     TEXT,
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "opted_out_at"    TIMESTAMP(3),
    "opt_out_reason"  TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_sessions_phone_e164_key" ON "whatsapp_sessions"("phone_e164");
CREATE INDEX "whatsapp_sessions_customer_id_idx" ON "whatsapp_sessions"("customer_id");
CREATE INDEX "whatsapp_sessions_opted_out_at_idx" ON "whatsapp_sessions"("opted_out_at");


CREATE TABLE "whatsapp_inbound" (
    "id"                   TEXT NOT NULL,
    "provider_message_id"  TEXT NOT NULL,
    "from_phone_e164"      TEXT NOT NULL,
    "message_type"         TEXT NOT NULL,
    "text_body"            TEXT,
    "is_opt_out_signal"    BOOLEAN NOT NULL DEFAULT false,
    "raw_payload"          JSONB NOT NULL,
    "received_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_inbound_provider_message_id_key" ON "whatsapp_inbound"("provider_message_id");
CREATE INDEX "whatsapp_inbound_from_phone_e164_received_at_idx" ON "whatsapp_inbound"("from_phone_e164", "received_at" DESC);
CREATE INDEX "whatsapp_inbound_received_at_idx" ON "whatsapp_inbound"("received_at" DESC);
