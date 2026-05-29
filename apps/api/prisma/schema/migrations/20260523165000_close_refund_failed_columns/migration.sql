-- Phase 101 (2026-05-23) — Phase 101-104 audit closures.
--
-- 1) close columns (closed_by, closed_by_actor_type, close_reason)
--    Phase 103 audit Gap #2/#3 — "who closed it and why" without
--    joining audit_logs.
--
-- 2) refund_failed_* (Phase 102 audit Gap #7) — symmetric pair to
--    refund_initiated_by/at for the manual mark-failed path.
--
-- 3) refund_next_retry_at + refund_max_retries (Phase 101 audit
--    Gap #6/#8) — per-return cap + indexable next-attempt-time so
--    the cron + UI can use them directly.
--
-- 4) Index for the QC/refund queue dashboards.

ALTER TABLE "returns"
  ADD COLUMN "closed_by"                    TEXT,
  ADD COLUMN "closed_by_actor_type"         TEXT,
  ADD COLUMN "close_reason"                 VARCHAR(500),
  ADD COLUMN "refund_failed_by"             TEXT,
  ADD COLUMN "refund_failed_by_actor_type"  TEXT,
  ADD COLUMN "refund_failed_at"             TIMESTAMP(3),
  ADD COLUMN "refund_next_retry_at"         TIMESTAMP(3),
  ADD COLUMN "refund_max_retries"           INTEGER;

-- Phase 103 audit Gap #19 — analytics index for "closed in last N days"
CREATE INDEX IF NOT EXISTS "returns_closed_at_idx"
  ON "returns" ("closed_at" DESC);

-- Phase 101 audit retry cron uses (status, refundReference IS NULL,
-- refundAttempts < cap, nextRetryAt < now). A composite on
-- (status, refund_next_retry_at) plus the existing status index
-- gets the planner to a fast scan.
CREATE INDEX IF NOT EXISTS "returns_status_refund_next_retry_idx"
  ON "returns" ("status", "refund_next_retry_at");
