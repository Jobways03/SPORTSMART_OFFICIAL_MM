-- Phase 75 (2026-05-22) — Phase 73 reject-flow audit Gap #25.
-- Per-seller accept SLA. NULL falls back to the platform default
-- (24h) handled in the repo. Range 1..168 (1h to 7d) enforced at
-- the service layer; CHECK constraint here is a defence-in-depth
-- backstop against direct SQL writers.

ALTER TABLE "sellers"
  ADD COLUMN "accept_sla_hours" INTEGER;

ALTER TABLE "sellers"
  ADD CONSTRAINT "sellers_accept_sla_hours_range_chk"
  CHECK ("accept_sla_hours" IS NULL OR ("accept_sla_hours" >= 1 AND "accept_sla_hours" <= 168));
