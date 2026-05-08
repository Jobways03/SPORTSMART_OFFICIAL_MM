-- ============================================
-- Phase 10 (PR 10.2) — Webhook endpoints + deliveries
-- ============================================

CREATE TYPE "WebhookEnvironment" AS ENUM ('LIVE', 'TEST');
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM (
    'PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED_RETRY', 'FAILED_DEAD'
);

CREATE TABLE "webhook_endpoints" (
    "id"                TEXT                    NOT NULL,
    "name"              TEXT                    NOT NULL,
    "url"               TEXT                    NOT NULL,
    "signing_secret"    TEXT                    NOT NULL,
    "event_types"       TEXT[]                  NOT NULL DEFAULT '{}',
    "environment"       "WebhookEnvironment"    NOT NULL DEFAULT 'LIVE',
    "status"            "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "seller_id"         TEXT,
    "affiliate_id"      TEXT,
    "retry_schedule"    INTEGER[]               NOT NULL DEFAULT '{}',
    "created_at"        TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)            NOT NULL,
    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_status_environment_idx"
    ON "webhook_endpoints" ("status", "environment");

CREATE TABLE "webhook_deliveries" (
    "id"                TEXT                  NOT NULL,
    "endpoint_id"       TEXT                  NOT NULL,
    "event_name"        TEXT                  NOT NULL,
    "dedupe_key"        TEXT                  NOT NULL,
    "payload"           JSONB                 NOT NULL,
    "signature"         TEXT                  NOT NULL,
    "status"            "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"          INTEGER               NOT NULL DEFAULT 0,
    "next_retry_at"     TIMESTAMP(3),
    "last_status_code"  INTEGER,
    "last_response"     TEXT,
    "last_error"        TEXT,
    "created_at"        TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)          NOT NULL,
    "finalized_at"      TIMESTAMP(3),
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_endpoint_id_fkey"
        FOREIGN KEY ("endpoint_id")
        REFERENCES "webhook_endpoints" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "webhook_deliveries_endpoint_event_dedupe_key"
    ON "webhook_deliveries" ("endpoint_id", "event_name", "dedupe_key");

CREATE INDEX "webhook_deliveries_status_next_retry_at_idx"
    ON "webhook_deliveries" ("status", "next_retry_at");

CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx"
    ON "webhook_deliveries" ("endpoint_id", "created_at");
