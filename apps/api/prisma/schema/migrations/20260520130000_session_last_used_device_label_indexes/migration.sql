-- Phase 17 (2026-05-20) — Session hardening for the customer auth flow.
--
-- Adds two operational columns + two coverage indexes:
--
--   1. last_used_at — stamped on each refresh-rotation. The
--      expiresAt column already slides forward on rotate, so without
--      a separate "last touched" timestamp we cannot distinguish an
--      idle-30-days session from one that was actively used 5
--      minutes ago. Needed for the inactive-session sweeper + the
--      account/sessions UI surface.
--
--   2. device_label — operator-friendly string derived from the
--      user-agent at session creation ("Chrome on macOS"). Pure
--      display data; not load-bearing.
--
--   3. @@index([userId, revokedAt]) + @@index([userId, expiresAt])
--      — UserAuthGuard runs `findUnique(where: { id: sessionId })`
--      per request and `revokeAllUserSessions(userId)` on logout-all.
--      The existing per-column userId index is a partial cover for
--      both; adding the composite indexes makes the (userId,
--      revokedAt IS NULL) and (userId, expiresAt) predicates
--      index-served.
--
-- Rollback: drop the indexes and columns. Nothing in the application
-- code path requires last_used_at to be non-null, so dropping is safe.

ALTER TABLE "sessions"
    ADD COLUMN "last_used_at" TIMESTAMP(3),
    ADD COLUMN "device_label" TEXT;

CREATE INDEX "sessions_user_id_revoked_at_idx"
    ON "sessions" ("user_id", "revoked_at");

CREATE INDEX "sessions_user_id_expires_at_idx"
    ON "sessions" ("user_id", "expires_at");
