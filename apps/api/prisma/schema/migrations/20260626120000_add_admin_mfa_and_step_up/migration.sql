-- Deferred admin-MFA + step-up columns (Phase 10 / 25 / 26 / PR 10.10).
-- These columns are already declared in prisma/schema/admin.prisma but were
-- never materialized in a migration; the API carried `as any` casts to compile
-- against the lagging client. This migration adds them so the columns exist in
-- the deployed DB and the casts can be removed.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS is safe whether or not a
-- squashed baseline already created any of these (a re-add is then a no-op).
-- Forward-only (the platform ships no down-migrations).

-- admins: TOTP secret/enrolment, backup codes, anti-replay + brute-force guard.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_secret_ciphertext" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_pending_secret_ciphertext" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_pending_expires_at" TIMESTAMP(3);
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_enabled_at" TIMESTAMP(3);
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_backup_codes_hashes" JSONB;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_last_used_step" INTEGER;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "failed_mfa_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "mfa_lock_until" TIMESTAMP(3);

-- admin_sessions: timestamp of the last fresh MFA step-up challenge. The
-- @RequiresStepUp() guard rejects requests where this is null or stale.
ALTER TABLE "admin_sessions" ADD COLUMN IF NOT EXISTS "step_up_verified_at" TIMESTAMP(3);
