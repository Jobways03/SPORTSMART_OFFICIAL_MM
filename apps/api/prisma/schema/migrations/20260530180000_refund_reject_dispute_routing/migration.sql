-- Phase 171 — Refund Approve/Reject Flow audit remediation.
--
-- Adds REJECTED + ROUTED_BACK_TO_DISPUTE refund statuses, the finance
-- route-back columns + linkedDisputeId on refund_instructions, the dispute
-- reopen-snapshot columns, and the DISPUTE_REFUND_REJECTED_NEEDS_REDECISION
-- admin-task kind.

-- ── #2/#3: refund-instruction finance-rejection statuses ─────────────────────
ALTER TYPE "RefundInstructionStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "RefundInstructionStatus" ADD VALUE IF NOT EXISTS 'ROUTED_BACK_TO_DISPUTE';

-- ── #11: admin-task kind for dispute re-decision ─────────────────────────────
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'DISPUTE_REFUND_REJECTED_NEEDS_REDECISION';

-- ── #4/#6/#1: refund_instructions route-back + customer-visible columns ───────
ALTER TABLE "refund_instructions"
  ADD COLUMN IF NOT EXISTS "linked_dispute_id"        TEXT,
  ADD COLUMN IF NOT EXISTS "customer_visible_reason"  TEXT,
  ADD COLUMN IF NOT EXISTS "routed_back_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "routed_back_by"           TEXT;

CREATE INDEX IF NOT EXISTS "refund_instructions_linked_dispute_id_idx"
  ON "refund_instructions"("linked_dispute_id");

-- Backfill linked_dispute_id for existing dispute-sourced instructions so the
-- new fast lookup covers historical rows too.
UPDATE "refund_instructions"
  SET "linked_dispute_id" = "source_id"
  WHERE "source_type" = 'DISPUTE' AND "linked_dispute_id" IS NULL;

-- ── #1/#14: dispute reopen-snapshot + SLA columns ────────────────────────────
ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "previous_decision_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "previous_decision_rationale" TEXT,
  ADD COLUMN IF NOT EXISTS "finance_rejection_reason"    TEXT,
  ADD COLUMN IF NOT EXISTS "finance_rejected_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reroute_due_by"              TIMESTAMP(3);
