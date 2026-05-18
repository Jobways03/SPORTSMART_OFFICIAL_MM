-- Phase 7 (2026-05-16) — Procurement approval SLA timestamps.
--
-- `sla_approve_by`  — deadline computed at submit-time from
--                     PROCUREMENT_APPROVAL_SLA_HOURS (default 48h).
-- `sla_breached_at` — set by the breach cron the first time a request
--                     blows past its deadline; the cron uses presence
--                     of this field to avoid re-notifying every tick.
--
-- The (status, sla_approve_by) composite index supports the cron's
-- "all SUBMITTED rows past deadline" scan in one index range read.

ALTER TABLE "procurement_requests"
    ADD COLUMN "sla_approve_by"   TIMESTAMP(3),
    ADD COLUMN "sla_breached_at"  TIMESTAMP(3);

CREATE INDEX "procurement_requests_status_sla_approve_by_idx"
    ON "procurement_requests"("status", "sla_approve_by");
