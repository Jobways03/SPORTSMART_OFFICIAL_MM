-- Follow-up #123 (2026-05-19) — AffiliateSession table.
--
-- Pre-existing affiliate auth issued a single 24h JWT with no refresh
-- token and no DB-side session. Mirrors the admin / seller / franchise
-- session pattern so refresh-token rotation + reuse detection apply
-- to the fifth persona.
--
-- Strategy:
--   1. Create affiliate_sessions table with refresh_token primary
--      lookup + previous_refresh_token_hash burned-slot for theft
--      detection (Phase 1 / C6).
--   2. Indexes on (affiliate_id), (refresh_token), and
--      (previous_refresh_token_hash) so the refresh-path lookups are
--      O(log n) and the reuse-detection secondary lookup is bounded.
--   3. ON DELETE CASCADE so deleting an affiliate clears its sessions.
--
-- Rollback: DROP TABLE "affiliate_sessions" — no FKs reference it.

CREATE TABLE "affiliate_sessions" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "affiliate_sessions_affiliate_id_idx"
    ON "affiliate_sessions" ("affiliate_id");
CREATE INDEX "affiliate_sessions_refresh_token_idx"
    ON "affiliate_sessions" ("refresh_token");
CREATE INDEX "affiliate_sessions_previous_refresh_token_hash_idx"
    ON "affiliate_sessions" ("previous_refresh_token_hash");

ALTER TABLE "affiliate_sessions"
    ADD CONSTRAINT "affiliate_sessions_affiliate_id_fkey"
    FOREIGN KEY ("affiliate_id") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
