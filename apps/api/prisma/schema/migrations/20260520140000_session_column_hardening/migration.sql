-- Phase 17 (2026-05-20) — Session column hardening, audit follow-up.
--
-- Three changes, all metadata-only or in-place (no row rewrites):
--
--   1. Rename `refresh_token` → `refresh_token_hash`. The column has
--      always stored SHA-256(hash) of the raw refresh token; only the
--      name lied. pg_dump readers and incident-response engineers
--      now see the truth. The Prisma client field name stays
--      `refreshToken` (via @map) so the 20+ call sites that pass
--      `where: { refreshToken: hashRefreshToken(input) }` do not
--      need to be touched.
--
--   2. Tighten `user_agent` to VARCHAR(512). User-agent strings are
--      typically 100–300 chars; a 1 MB pathological UA was previously
--      accepted into TEXT and bloated every session row. The
--      Phase-17 use-case already truncates to 512 in code; this
--      mirrors it at the storage boundary.
--
--   3. Tighten `ip_address` to VARCHAR(45). IPv6 max printable form
--      with a zone id is 45 chars; v4 fits well under. Bounds the
--      storage envelope without losing any legitimate value.
--
--   4. Tighten `device_label` to VARCHAR(64). Display-only string;
--      no business value past short device names.
--
-- All four operations are O(1) metadata in PostgreSQL when the
-- existing data fits the new bound. The truncate-in-code path means
-- no existing row should exceed the new caps; if a row somehow does
-- (legacy data from before truncation), Postgres will raise — handle
-- via a one-off UPDATE before applying this migration in prod.
--
-- Rollback: rename the column back; ALTER COLUMN TYPE TEXT for the
-- three VarChar columns.

-- 1) Column rename
ALTER TABLE "sessions"
    RENAME COLUMN "refresh_token" TO "refresh_token_hash";

-- The Prisma-managed index name was "sessions_refresh_token_idx".
-- Rename it to match the new column for consistency in pg_indexes
-- output and EXPLAIN plans.
ALTER INDEX IF EXISTS "sessions_refresh_token_idx"
    RENAME TO "sessions_refresh_token_hash_idx";

-- 2-4) VarChar length caps. ALTER COLUMN TYPE with a USING clause is
-- safe when all existing values fit; the cast is implicit for
-- TEXT → VARCHAR(n).
ALTER TABLE "sessions"
    ALTER COLUMN "user_agent"   TYPE VARCHAR(512),
    ALTER COLUMN "ip_address"   TYPE VARCHAR(45),
    ALTER COLUMN "device_label" TYPE VARCHAR(64);
