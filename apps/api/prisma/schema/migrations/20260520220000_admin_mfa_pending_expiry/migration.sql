-- Phase 25 (2026-05-20) — Admin MFA enrolment hardening.
--
-- 1) Pending-secret expiry column. Set at /enroll/begin; the daily
--    sweep cron clears expired rows so abandoned enrolments don't
--    leave a recoverable secret indefinitely.
ALTER TABLE "admins"
  ADD COLUMN IF NOT EXISTS "mfa_pending_expires_at" TIMESTAMP(3);

-- 2) Index that powers the sweep cron's `WHERE mfa_pending_expires_at
--    IS NOT NULL AND mfa_pending_expires_at < now()` scan. Partial
--    index keeps it tiny — only rows currently in the middle of
--    enrolment show up here.
CREATE INDEX IF NOT EXISTS "admins_mfa_pending_expires_at_idx"
  ON "admins" ("mfa_pending_expires_at")
  WHERE "mfa_pending_expires_at" IS NOT NULL;
