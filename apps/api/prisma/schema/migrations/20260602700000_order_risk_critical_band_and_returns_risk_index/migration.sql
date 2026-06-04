-- Phase 174 (audit #224/#227) — 4th order risk band above RED for the
-- highest-risk cohort. Held to the bounded enforcement gate (mandatory
-- approve reason, excluded from bulk-approve). Additive enum value: existing
-- GREEN/YELLOW/RED rows are unaffected; only newly-scored orders above the
-- RED threshold (score > 30) land in CRITICAL.
ALTER TYPE "OrderRiskBand" ADD VALUE IF NOT EXISTS 'CRITICAL';

-- Phase 174 (audit #228) — composite index backing the returns risk-review
-- dashboard's server-side "status + score range" filter
-- (WHERE status = ? AND risk_score >= ?), replacing the client-side
-- bucketing over a truncated 100-row page.
CREATE INDEX IF NOT EXISTS "returns_status_risk_score_idx"
  ON "returns" ("status", "risk_score");
