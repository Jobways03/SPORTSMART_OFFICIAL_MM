-- Phase 159h (2026-05-27) — capture why an affiliate was reactivated.
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "reactivation_reason" TEXT;
