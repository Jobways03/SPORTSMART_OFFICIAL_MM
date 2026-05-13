-- Phase 3 (PR 3.2) — hash existing refresh tokens at rest.
--
-- Pre-PR, the four session tables stored the refresh token as the
-- plaintext UUID emitted at login. A DB compromise (backup leak,
-- accidental SELECT *, stolen ops-shell session) hands an attacker
-- every live session — indistinguishable from the legitimate owner.
--
-- The application layer (PR 3.2) now hashes via SHA-256 at the
-- storage boundary. This migration backfills existing rows so
-- clients holding valid refresh tokens continue to work after deploy
-- — their raw token, hashed at lookup, matches the now-hashed DB
-- row.
--
-- Idempotency: SHA-256 hex is exactly 64 chars; a UUID is 36 chars
-- (with hyphens). Filter `WHERE length(refresh_token) <> 64` so re-
-- running the migration (manual replay, dev rebuild) does NOT double-
-- hash and break sessions.
--
-- pgcrypto is required for `digest()`. The extension is idempotent
-- via IF NOT EXISTS; safe in all environments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "sessions"
   SET "refresh_token" = encode(digest("refresh_token", 'sha256'), 'hex')
 WHERE length("refresh_token") <> 64;

UPDATE "admin_sessions"
   SET "refresh_token" = encode(digest("refresh_token", 'sha256'), 'hex')
 WHERE length("refresh_token") <> 64;

UPDATE "seller_sessions"
   SET "refresh_token" = encode(digest("refresh_token", 'sha256'), 'hex')
 WHERE length("refresh_token") <> 64;

UPDATE "franchise_sessions"
   SET "refresh_token" = encode(digest("refresh_token", 'sha256'), 'hex')
 WHERE length("refresh_token") <> 64;
