-- Phase 26 (2026-05-20) — per-admin MFA brute-force counter.
--
-- Defeats per-IP throttle bypass via NAT or rotating proxies: a
-- distinct count + lock-until lives on each Admin row. Counter is
-- incremented in the MFA verify use case on bad TOTP / bad backup
-- code, and reset to zero on successful verify. Lock window
-- mirrors the password lockout (15 min).
ALTER TABLE "admins"
  ADD COLUMN IF NOT EXISTS "failed_mfa_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mfa_lock_until"      TIMESTAMP(3);
