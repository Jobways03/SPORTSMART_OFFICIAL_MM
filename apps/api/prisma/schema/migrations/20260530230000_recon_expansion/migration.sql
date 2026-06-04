-- Phase 173 — Finance Reconciliation Runs audit remediation (part 1: enums + columns).
--
-- New enum values are added here; the partial-unique concurrency guard that
-- REFERENCES the new 'QUEUED' value lives in the next migration
-- (20260530230001) because Postgres forbids using a newly-added enum value in
-- the same transaction that added it.

-- ── #5 expanded reconciliation coverage ──────────────────────────────────────
ALTER TYPE "ReconciliationKind" ADD VALUE IF NOT EXISTS 'AFFILIATE_PAYOUT';
ALTER TYPE "ReconciliationKind" ADD VALUE IF NOT EXISTS 'COMMISSION';
ALTER TYPE "ReconciliationKind" ADD VALUE IF NOT EXISTS 'TDS';
ALTER TYPE "ReconciliationKind" ADD VALUE IF NOT EXISTS 'TCS';

-- ── #1/#14 async run lifecycle states ────────────────────────────────────────
ALTER TYPE "ReconciliationStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "ReconciliationStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

-- ── #7 granular discrepancy classification ───────────────────────────────────
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'MISSING_PAYMENT';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'DUPLICATE_PAYMENT';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'MISSING_REFUND';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'DUPLICATE_REFUND';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'MISSING_UTR';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'PROVIDER_REFERENCE_MISSING';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'SETTLEMENT_MISMATCH';
ALTER TYPE "DiscrepancyKind" ADD VALUE IF NOT EXISTS 'ORPHAN_LEDGER_ENTRY';

-- ── #18 explicit triage state ────────────────────────────────────────────────
ALTER TYPE "DiscrepancyStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW';

-- ── run columns: human id + async queued-at ──────────────────────────────────
ALTER TABLE "reconciliation_runs"
  ADD COLUMN IF NOT EXISTS "run_number" TEXT,
  ADD COLUMN IF NOT EXISTS "queued_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "reconciliation_runs_run_number_key"
  ON "reconciliation_runs" ("run_number");

CREATE INDEX IF NOT EXISTS "reconciliation_runs_kind_status_idx"
  ON "reconciliation_runs" ("kind", "status");

-- ── #8/#9 discrepancy triage columns ─────────────────────────────────────────
ALTER TABLE "reconciliation_discrepancies"
  ADD COLUMN IF NOT EXISTS "severity"            INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "difference_in_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "suggested_action"    TEXT;

CREATE INDEX IF NOT EXISTS "reconciliation_discrepancies_status_severity_idx"
  ON "reconciliation_discrepancies" ("status", "severity" DESC);
