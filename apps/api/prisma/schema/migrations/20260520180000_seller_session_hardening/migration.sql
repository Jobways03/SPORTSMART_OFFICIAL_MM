-- Phase 21 (2026-05-20) — Seller session column hardening (audit
-- follow-up). Mirrors the customer-side Phase-17 migration. Two
-- changes, both metadata-only:
--
--   1. Rename `refresh_token` → `refresh_token_hash`. The column has
--      always stored SHA-256(hex) of the raw refresh token via
--      `hashRefreshToken()` — only the name lied. The Prisma client
--      field name stays `refreshToken` (via @map) so existing call
--      sites need no change.
--
--   2. Add composite index `(seller_id, revoked_at)` for
--      SellerAuthGuard's per-request "is this session still valid for
--      this seller" lookup. Without it the guard scans the
--      seller-only index then filters revoked rows in memory.
--
-- Rollback: rename the column back; drop the composite index.

-- 1) Column rename
ALTER TABLE "seller_sessions"
    RENAME COLUMN "refresh_token" TO "refresh_token_hash";

-- The Prisma-managed single-column index was
-- "seller_sessions_refresh_token_idx". Rename to match the new column.
ALTER INDEX IF EXISTS "seller_sessions_refresh_token_idx"
    RENAME TO "seller_sessions_refresh_token_hash_idx";

-- 2) Composite index for guard's per-request lookup. CONCURRENTLY
-- avoids locking the table; safe in prod.
CREATE INDEX IF NOT EXISTS "seller_sessions_seller_id_revoked_at_idx"
    ON "seller_sessions" ("seller_id", "revoked_at");
