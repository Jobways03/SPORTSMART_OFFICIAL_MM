-- Phase 12 GST — Section 34 credit-note time-bar cron + AdminTask.
--
-- Daily cron classifies QC-approved returns into eligibility buckets:
--   ELIGIBLE                  — within Section 34 window; CreditNoteService
--                               will issue a real CREDIT_NOTE.
--   TIME_BARRED               — past 30 Sept of FY+1; no GST output
--                               reduction possible. Refund still goes out
--                               via wallet adjustment (Phase 13), but the
--                               GST liability sticks to the platform.
--   REQUIRES_FINANCE_REVIEW   — borderline cases (e.g. within 7 days of
--                               cutoff, or source invoice cancellation
--                               status complicates reversal). Finance lead
--                               opens manually.
--
-- New AdminTaskKind values:
--   GST_CREDIT_NOTE_TIME_BARRED          — opened when a return crosses
--                                          the Sec 34 deadline before the
--                                          credit note was issued. Finance
--                                          must approve the wallet path +
--                                          absorb the GST cost.
--   GST_CREDIT_NOTE_TIME_BAR_APPROACHING — opened when a return is within
--                                          7 days of the deadline and the
--                                          credit note hasn't been issued
--                                          yet. Early-warning for ops.
--
-- New Return columns:
--   credit_note_eligibility_status        — current bucket (nullable; legacy
--                                          rows + non-refund returns stay
--                                          NULL until the cron classifies).
--   credit_note_eligibility_checked_at    — last cron pass timestamp.
--   credit_note_time_bar_reason           — human-readable reason recorded
--                                          on the wallet_adjustment path.
--   finance_reviewed_by / _at             — manual override audit trail.
--
-- See docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md.

-- ── New AdminTaskKind values ──────────────────────────────────────
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'GST_CREDIT_NOTE_TIME_BARRED';
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'GST_CREDIT_NOTE_TIME_BAR_APPROACHING';

-- ── New CreditNoteEligibilityStatus enum ──────────────────────────
DO $$
BEGIN
  CREATE TYPE "CreditNoteEligibilityStatus" AS ENUM (
    'ELIGIBLE',
    'TIME_BARRED',
    'REQUIRES_FINANCE_REVIEW'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- ── Return columns ────────────────────────────────────────────────
ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "credit_note_eligibility_status"
    "CreditNoteEligibilityStatus",
  ADD COLUMN IF NOT EXISTS "credit_note_eligibility_checked_at"
    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "credit_note_time_bar_reason"
    TEXT,
  ADD COLUMN IF NOT EXISTS "finance_reviewed_by"
    TEXT,
  ADD COLUMN IF NOT EXISTS "finance_reviewed_at"
    TIMESTAMPTZ;

-- Partial index — only rows the cron must re-scan or finance must triage.
-- ELIGIBLE rows have been handed off to CreditNoteService and don't need
-- to come back through this cron, so we exclude them from the index.
CREATE INDEX IF NOT EXISTS "returns_credit_note_eligibility_idx"
  ON "returns" ("credit_note_eligibility_status")
  WHERE "credit_note_eligibility_status" IS NOT NULL
    AND "credit_note_eligibility_status" <> 'ELIGIBLE';

-- Covering index for the cron sweep: returns past QC that haven't been
-- classified yet, ordered by qc_completed_at ascending (oldest first so
-- approaching-cutoff cases get attention before brand-new returns).
CREATE INDEX IF NOT EXISTS "returns_credit_note_eligibility_pending_idx"
  ON "returns" ("qc_completed_at")
  WHERE "credit_note_eligibility_status" IS NULL
    AND "qc_completed_at" IS NOT NULL;
