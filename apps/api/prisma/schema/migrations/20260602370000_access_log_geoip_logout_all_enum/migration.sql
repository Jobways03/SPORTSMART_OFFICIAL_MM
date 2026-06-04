-- Phase 201 — Customer Access History remediation (AUDIT #201)
--
-- #17  LOGOUT_ALL_DEVICES enum value: distinguishes a "sign out
--      everywhere" (revokes every session) from a single-session
--      LOGOUT on the customer access-history surface.
-- #13  GeoIP enrichment hook columns (country / city). Nullable, NOT
--      backfilled — written only once a GeoIP provider is wired (the
--      provider integration itself is deferred; these are the schema
--      hook so the enrichment can land without another migration).

-- ── #17 — new enum value ────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE is non-transactional in PostgreSQL; it must
-- run outside an explicit transaction block. Prisma applies each
-- migration statement-by-statement, so this is safe. IF NOT EXISTS
-- makes the migration idempotent across re-runs.
ALTER TYPE "AccessEventKind" ADD VALUE IF NOT EXISTS 'LOGOUT_ALL_DEVICES';

-- ── #13 — GeoIP hook columns (nullable, no backfill needed) ─────────
ALTER TABLE "access_logs" ADD COLUMN IF NOT EXISTS "country" VARCHAR(2);
ALTER TABLE "access_logs" ADD COLUMN IF NOT EXISTS "city" TEXT;
