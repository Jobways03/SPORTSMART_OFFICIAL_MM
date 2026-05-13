-- Phase 0 (PR 0.14) — SLA tracking on admin_tasks.
--
-- Adds `sla_breach_at` (deadline) and `sla_breached_at` (escalation
-- marker) so the SLA-breach detector cron can find OPEN/CLAIMED tasks
-- past their deadline, fire `disputes.refund_failure.sla_breached`,
-- notify the customer, and prevent re-firing on subsequent ticks.
--
-- Both columns are nullable for backfill safety — existing rows keep
-- their unbounded behaviour. Producers (dispute.decide's failure
-- path) opt new rows into the SLA by setting the deadline at create.

ALTER TABLE "admin_tasks"
  ADD COLUMN "sla_breach_at"   TIMESTAMP(3),
  ADD COLUMN "sla_breached_at" TIMESTAMP(3);

-- Drives the cron's filter: only OPEN/CLAIMED tasks with a deadline in
-- the past AND not yet escalated. PostgreSQL can use the composite
-- index for both halves of the predicate.
CREATE INDEX "admin_tasks_status_sla_breach_at_idx"
  ON "admin_tasks" ("status", "sla_breach_at");
