-- Phase 1 / C6 (2026-05-19) — refresh-token reuse detection for the
-- three non-customer actors.
--
-- The customer `sessions` table got `previous_refresh_token_hash` in
-- the 2026-05-12 migration; this round extends the same pattern to
-- admin / seller / franchise sessions. The column holds the SHA-256
-- of the LAST burned refresh token; a refresh request whose payload
-- hashes to this value (after missing on the current `refresh_token`
-- slot) is theft of an already-rotated token. The recovery action is
-- to revoke every session for that actor.
--
-- Affiliate currently has no session model at all (single-token JWT
-- with no refresh endpoint); that's a follow-up build.
--
-- Strategy:
--   1. Add the nullable column to each of the three session tables.
--   2. Index it so the secondary-lookup hit on the rare theft path
--      is bounded — the primary-token lookup is still index-served
--      on the existing `refresh_token` index.
--
-- Rollback: DROP COLUMN previous_refresh_token_hash is safe on each
-- table; nothing FKs to it.

ALTER TABLE "admin_sessions"
    ADD COLUMN "previous_refresh_token_hash" TEXT;
CREATE INDEX "admin_sessions_previous_refresh_token_hash_idx"
    ON "admin_sessions" ("previous_refresh_token_hash");

ALTER TABLE "seller_sessions"
    ADD COLUMN "previous_refresh_token_hash" TEXT;
CREATE INDEX "seller_sessions_previous_refresh_token_hash_idx"
    ON "seller_sessions" ("previous_refresh_token_hash");

ALTER TABLE "franchise_sessions"
    ADD COLUMN "previous_refresh_token_hash" TEXT;
CREATE INDEX "franchise_sessions_previous_refresh_token_hash_idx"
    ON "franchise_sessions" ("previous_refresh_token_hash");
