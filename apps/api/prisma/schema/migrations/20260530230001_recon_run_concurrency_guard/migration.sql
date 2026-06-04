-- Phase 173 (Recon audit #2) — concurrent-run prevention (part 2).
--
-- Race-proof DB-level guard: at most ONE live (QUEUED or RUNNING) reconciliation
-- run may exist per (kind, period). Two admins launching the same (kind, period)
-- simultaneously → the second INSERT hits this partial unique index and fails
-- with P2002, which the service maps to a 409 ConflictAppException. References
-- the 'QUEUED' enum value added in 20260530230000, so it must be a separate
-- migration (Postgres forbids using a freshly-added enum value in the same
-- transaction that added it).

CREATE UNIQUE INDEX IF NOT EXISTS "reconciliation_runs_live_kind_period_uq"
  ON "reconciliation_runs" ("kind", "period_start", "period_end")
  WHERE "status" IN ('QUEUED', 'RUNNING');
