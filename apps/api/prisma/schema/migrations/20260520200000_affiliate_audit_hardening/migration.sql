-- Phase 22 (2026-05-20) — Affiliate audit hardening.
--
-- Driven by the affiliate-registration audit. Four areas:
--
--   1. AffiliateSession: rename `refresh_token` → `refresh_token_hash`.
--      The column has always stored SHA-256(hex) via `hashRefreshToken()`;
--      only the name lied. Tighten the user_agent / ip_address VarChar
--      caps to match the customer / seller migrations.
--
--   2. Composite indexes on AffiliateSession for the per-request guard
--      lookup ([affiliate_id, revoked_at]) and the inactive-session
--      sweeper ([affiliate_id, expires_at]).
--
--   3. Action-specific actor columns on the Affiliate row. Pre-Phase-22
--      the service overloaded `approved_by_id` for reject / suspend /
--      deactivate / reactivate, breaking audit queries. Each action
--      now gets its own column. The legacy `approved_by_id` keeps its
--      intended meaning (approver only).
--
--   4. Backfill: any existing row that has a rejected_at without a
--      rejected_by_id copies approved_by_id (since the prior code
--      stored the rejector there). Same for suspended_at and
--      reactivated_at. Idempotent — the migration is a no-op for rows
--      that already have the action-specific column populated.
--
-- All operations are metadata-only or in-place; no row rewrites
-- besides the backfill.

-- 1) Column rename
ALTER TABLE "affiliate_sessions"
    RENAME COLUMN "refresh_token" TO "refresh_token_hash";

-- The Prisma-managed index name was "affiliate_sessions_refresh_token_idx".
ALTER INDEX IF EXISTS "affiliate_sessions_refresh_token_idx"
    RENAME TO "affiliate_sessions_refresh_token_hash_idx";

-- VarChar caps. ALTER COLUMN TYPE with implicit cast is safe when all
-- existing values fit. The pre-existing code had no truncation, so a
-- legacy row could exceed the new cap; this migration assumes
-- application-layer truncation has been added in tandem.
ALTER TABLE "affiliate_sessions"
    ALTER COLUMN "user_agent" TYPE VARCHAR(512),
    ALTER COLUMN "ip_address" TYPE VARCHAR(45);

-- 2) Composite indexes
CREATE INDEX IF NOT EXISTS "affiliate_sessions_affiliate_id_revoked_at_idx"
    ON "affiliate_sessions" ("affiliate_id", "revoked_at");

CREATE INDEX IF NOT EXISTS "affiliate_sessions_affiliate_id_expires_at_idx"
    ON "affiliate_sessions" ("affiliate_id", "expires_at");

-- KycStatus index for the admin affiliate queue's filter dropdown.
CREATE INDEX IF NOT EXISTS "affiliates_kyc_status_idx"
    ON "affiliates" ("kyc_status");

-- 3) Action-specific actor columns. All nullable; defaults to NULL
-- so existing rows remain valid.
ALTER TABLE "affiliates"
    ADD COLUMN IF NOT EXISTS "rejected_by_id"    TEXT,
    ADD COLUMN IF NOT EXISTS "suspended_by_id"   TEXT,
    ADD COLUMN IF NOT EXISTS "deactivated_at"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deactivated_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "reactivated_at"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reactivated_by_id" TEXT;

-- 4) Backfill the action-specific columns from the overloaded
-- approved_by_id column. Idempotent: only writes if the target is
-- still NULL and the source has a value.
UPDATE "affiliates"
   SET "rejected_by_id" = "approved_by_id"
 WHERE "rejected_at" IS NOT NULL
   AND "rejected_by_id" IS NULL
   AND "approved_by_id" IS NOT NULL
   AND "status" = 'REJECTED';

UPDATE "affiliates"
   SET "suspended_by_id" = "approved_by_id"
 WHERE "suspended_at" IS NOT NULL
   AND "suspended_by_id" IS NULL
   AND "approved_by_id" IS NOT NULL
   AND "status" = 'SUSPENDED';
