-- Phase 170 — Refund-Instruction Queue audit remediation.
--
-- Adds the NEEDS_CLARIFICATION status, approval-SLA + clarification columns, a
-- status-transition history table, and the REFUND_CLARIFICATION_REQUESTED
-- admin-task kind.

-- ── #10: NEEDS_CLARIFICATION refund-instruction status ───────────────────────
ALTER TYPE "RefundInstructionStatus" ADD VALUE IF NOT EXISTS 'NEEDS_CLARIFICATION';

-- ── #11: dedicated admin-task kind for refund clarification requests ─────────
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'REFUND_CLARIFICATION_REQUESTED';

-- ── #6 / #10: SLA + clarification columns on refund_instructions ─────────────
ALTER TABLE "refund_instructions"
  ADD COLUMN IF NOT EXISTS "approval_due_by"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clarification_note"  TEXT,
  ADD COLUMN IF NOT EXISTS "clarification_by"    TEXT,
  ADD COLUMN IF NOT EXISTS "clarification_at"    TIMESTAMP(3);

-- ── #6: overdue sweep index ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "refund_instructions_status_approval_due_by_idx"
  ON "refund_instructions"("status", "approval_due_by");

-- ── #16: status-transition history ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "refund_instruction_status_history" (
  "id"             TEXT NOT NULL,
  "instruction_id" TEXT NOT NULL,
  "from_status"    "RefundInstructionStatus",
  "to_status"      "RefundInstructionStatus" NOT NULL,
  "actor_id"       TEXT,
  "notes"          TEXT,
  "occurred_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refund_instruction_status_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "refund_instruction_status_history"
  ADD CONSTRAINT "refund_instruction_status_history_instruction_id_fkey"
  FOREIGN KEY ("instruction_id") REFERENCES "refund_instructions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "refund_instruction_status_history_instruction_occurred_idx"
  ON "refund_instruction_status_history"("instruction_id", "occurred_at");
