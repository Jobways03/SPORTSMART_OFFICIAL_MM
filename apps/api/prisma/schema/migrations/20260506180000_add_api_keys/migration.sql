-- ============================================
-- Phase 10 (PR 10.1) — Public API keys + usage audit
-- ============================================

CREATE TYPE "ApiKeyEnvironment" AS ENUM ('LIVE', 'TEST');
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "api_keys" (
    "id"                       TEXT                NOT NULL,
    "name"                     TEXT                NOT NULL,
    "description"              TEXT,
    "key_prefix"               TEXT                NOT NULL,
    "key_hash"                 TEXT                NOT NULL,
    "scopes"                   TEXT[]              NOT NULL DEFAULT '{}',
    "environment"              "ApiKeyEnvironment" NOT NULL DEFAULT 'LIVE',
    "status"                   "ApiKeyStatus"      NOT NULL DEFAULT 'ACTIVE',
    "seller_id"                TEXT,
    "affiliate_id"             TEXT,
    "rate_limit_per_minute"    INTEGER,
    "last_used_at"             TIMESTAMP(3),
    "revoked_at"               TIMESTAMP(3),
    "revoked_by"               TEXT,
    "created_at"               TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3)        NOT NULL,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys" ("key_hash");
CREATE INDEX "api_keys_status_idx" ON "api_keys" ("status");
CREATE INDEX "api_keys_seller_id_idx" ON "api_keys" ("seller_id");
CREATE INDEX "api_keys_affiliate_id_idx" ON "api_keys" ("affiliate_id");

CREATE TABLE "api_key_usages" (
    "id"           TEXT         NOT NULL,
    "key_id"       TEXT         NOT NULL,
    "method"       TEXT         NOT NULL,
    "path"         TEXT         NOT NULL,
    "status"       INTEGER      NOT NULL,
    "duration_ms"  INTEGER      NOT NULL,
    "ip_prefix"    TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_key_usages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_key_usages_key_id_created_at_idx"
    ON "api_key_usages" ("key_id", "created_at");
CREATE INDEX "api_key_usages_status_created_at_idx"
    ON "api_key_usages" ("status", "created_at");
