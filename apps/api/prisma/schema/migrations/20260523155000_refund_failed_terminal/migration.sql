-- Phase 100 (2026-05-23) — Phase 98 audit Gap #18 closure.
--
-- REFUND_FAILED terminal status so refunds that exhausted all retries
-- (REFUND_MAX_RETRY_ATTEMPTS) have a dedicated state instead of being
-- pinned in REFUND_PROCESSING indefinitely.
--
-- Customer-facing dashboards filter "stuck refunds" via this column;
-- the existing RETURN_REFUND_FAILED AdminTask kind drives ops triage.

ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'REFUND_FAILED';
