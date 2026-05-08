-- Phase 13 (P1.11) — return risk scoring.
--
-- A 0-100 risk score is computed at return-creation time from a small
-- set of rule-based dimensions (customer abuse, recent return rate,
-- high-value-weak-evidence, etc). The score routes auto-approval:
--   < threshold → auto-approve as before
--   ≥ threshold → admin manual review (return stays in REQUESTED).
--
-- The flag list is a compact audit trail of *which* dimensions fired,
-- so admin can see "why is this return risky" at a glance instead of
-- re-running the scorer.

ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "risk_score"      INTEGER,
  ADD COLUMN IF NOT EXISTS "risk_flags"      JSONB,
  ADD COLUMN IF NOT EXISTS "risk_scored_at"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "returns_risk_score_idx"
  ON "returns" ("risk_score");
