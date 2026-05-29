-- Phase 23 (2026-05-20) — Admin session column hardening + audit gaps.
--
-- Driven by the admin user-management audit. Two areas:
--
--   1. AdminSession: rename `refresh_token` → `refresh_token_hash`. The
--      column has always stored SHA-256(hex) via `hashRefreshToken()`;
--      only the name lied. Tighten the user_agent / ip_address VarChar
--      caps to match the customer / seller / affiliate hardening
--      migrations.
--
--   2. Composite indexes for the per-request guard lookup and the
--      inactive-session sweeper / "active sessions" UI.
--
-- All operations are metadata-only or in-place; no row rewrites.

-- 1) Column rename
ALTER TABLE "admin_sessions"
    RENAME COLUMN "refresh_token" TO "refresh_token_hash";

-- The Prisma-managed index name was "admin_sessions_refresh_token_idx".
ALTER INDEX IF EXISTS "admin_sessions_refresh_token_idx"
    RENAME TO "admin_sessions_refresh_token_hash_idx";

-- VarChar caps. Implicit cast safe when existing values fit.
ALTER TABLE "admin_sessions"
    ALTER COLUMN "user_agent" TYPE VARCHAR(512),
    ALTER COLUMN "ip_address" TYPE VARCHAR(45);

-- 2) Composite indexes
CREATE INDEX IF NOT EXISTS "admin_sessions_admin_id_revoked_at_idx"
    ON "admin_sessions" ("admin_id", "revoked_at");

CREATE INDEX IF NOT EXISTS "admin_sessions_admin_id_expires_at_idx"
    ON "admin_sessions" ("admin_id", "expires_at");
