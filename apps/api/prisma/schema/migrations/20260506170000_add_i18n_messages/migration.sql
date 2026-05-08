-- ============================================
-- Phase 9 (PR 9.2) — i18n message catalogue
-- ============================================

CREATE TABLE "i18n_messages" (
    "locale"                   TEXT         NOT NULL,
    "key"                      TEXT         NOT NULL,
    "body"                     TEXT         NOT NULL,
    "short_body"               TEXT,
    "description"              TEXT,
    "updated_by_actor_type"    TEXT,
    "updated_by_actor_id"      TEXT,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL,
    CONSTRAINT "i18n_messages_pkey" PRIMARY KEY ("locale", "key")
);

CREATE INDEX "i18n_messages_key_idx" ON "i18n_messages" ("key");
