-- ============================================
-- Phase 7 (PR 7.3) — File URL audit log
-- ============================================

CREATE TABLE "file_url_audits" (
    "id"              TEXT         NOT NULL,
    "file_id"         TEXT         NOT NULL,
    "requester_id"    TEXT         NOT NULL,
    "requester_role"  TEXT,
    "requester_type"  TEXT         NOT NULL,
    "ip_address"      TEXT,
    "user_agent"      TEXT,
    "expires_at"      TIMESTAMP(3),
    "ttl_seconds"     INTEGER      NOT NULL,
    "denied"          BOOLEAN      NOT NULL DEFAULT false,
    "deny_reason"     TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_url_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "file_url_audits_file_id_created_at_idx"
    ON "file_url_audits" ("file_id", "created_at");

CREATE INDEX "file_url_audits_requester_id_created_at_idx"
    ON "file_url_audits" ("requester_id", "created_at");

CREATE INDEX "file_url_audits_denied_created_at_idx"
    ON "file_url_audits" ("denied", "created_at");
