-- Phase 28 (2026-05-21) — extend AdminImpersonationLog for multi-actor.
--
-- The pre-Phase-28 shape was seller-only (`seller_id` required, no
-- franchise column). Franchise impersonation existed as code but had
-- nowhere to log to, so it ran silently. This migration:
--
--   1. Adds `target_actor_type` (enum SELLER | FRANCHISE) and
--      `target_actor_id` as the new canonical target columns.
--   2. Adds `token_jti` (unique) for true revocation via Redis lookup.
--   3. Adds `reason` so admins can record why the impersonation was
--      needed (compliance / forensic).
--   4. Adds `revoked_at` + `revoked_reason` separate from
--      `ended_at` — distinguishes clean exit from force-revoke.
--   5. Relaxes the old `seller_id` to nullable so franchise rows can
--      store NULL there (a destructive drop would break readers).
--   6. Backfills pre-Phase-28 seller rows so target_actor_type +
--      target_actor_id are populated.
--   7. Adds the new lookup indexes.

CREATE TYPE "ImpersonationTargetType" AS ENUM ('SELLER', 'FRANCHISE');

-- Step 1: add the new columns. target_actor_type + target_actor_id
-- need to be nullable temporarily so we can backfill before the
-- final NOT NULL constraint lands.
ALTER TABLE "admin_impersonation_logs"
  ADD COLUMN IF NOT EXISTS "target_actor_type" "ImpersonationTargetType",
  ADD COLUMN IF NOT EXISTS "target_actor_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "token_jti"         TEXT,
  ADD COLUMN IF NOT EXISTS "reason"            TEXT,
  ADD COLUMN IF NOT EXISTS "revoked_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revoked_reason"    TEXT;

-- Step 2: backfill existing rows. All pre-Phase-28 rows are seller
-- impersonations by construction.
UPDATE "admin_impersonation_logs"
SET "target_actor_type" = 'SELLER',
    "target_actor_id"   = "seller_id"
WHERE "target_actor_type" IS NULL
  AND "seller_id" IS NOT NULL;

-- Step 3: tighten constraints on the new canonical columns.
ALTER TABLE "admin_impersonation_logs"
  ALTER COLUMN "target_actor_type" SET NOT NULL,
  ALTER COLUMN "target_actor_id"   SET NOT NULL;

-- Step 4: relax seller_id so franchise rows can omit it.
ALTER TABLE "admin_impersonation_logs"
  ALTER COLUMN "seller_id" DROP NOT NULL;

-- Step 5: unique index on token_jti for fast revocation lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "admin_impersonation_logs_token_jti_key"
  ON "admin_impersonation_logs" ("token_jti")
  WHERE "token_jti" IS NOT NULL;

-- Step 6: query-pattern indexes.
CREATE INDEX IF NOT EXISTS "admin_impersonation_logs_target_idx"
  ON "admin_impersonation_logs" ("target_actor_type", "target_actor_id");

CREATE INDEX IF NOT EXISTS "admin_impersonation_logs_started_at_idx"
  ON "admin_impersonation_logs" ("started_at");

CREATE INDEX IF NOT EXISTS "admin_impersonation_logs_ended_at_idx"
  ON "admin_impersonation_logs" ("ended_at");
