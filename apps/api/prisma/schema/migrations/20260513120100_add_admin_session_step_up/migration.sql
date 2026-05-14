-- Add admin_sessions.step_up_verified_at — schema-declared but DB-missing.
-- Part of the same in-flight admin-MFA / step-up-auth work as
-- 20260513120000_add_admin_mfa_columns. Nullable, no backfill needed.

ALTER TABLE "admin_sessions"
  ADD COLUMN "step_up_verified_at" TIMESTAMP(3);
