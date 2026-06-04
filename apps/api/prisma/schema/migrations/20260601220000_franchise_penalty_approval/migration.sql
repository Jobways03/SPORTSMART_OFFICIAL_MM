-- Phase 181 (#11) — two-person control for high-value franchise penalties.

CREATE TYPE "FranchisePenaltyApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "franchise_penalty_approvals" (
  "id"                    TEXT NOT NULL,
  "franchise_id"          TEXT NOT NULL,
  "amount"                DECIMAL(12,2) NOT NULL,
  "reason"                TEXT NOT NULL,
  "status"                "FranchisePenaltyApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requested_by_admin_id" TEXT NOT NULL,
  "approved_by_admin_id"  TEXT,
  "decision_reason"       TEXT,
  "ledger_entry_id"       TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at"            TIMESTAMP(3),
  CONSTRAINT "franchise_penalty_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "franchise_penalty_approvals_status_created_at_idx" ON "franchise_penalty_approvals"("status","created_at");
CREATE INDEX "franchise_penalty_approvals_franchise_id_idx" ON "franchise_penalty_approvals"("franchise_id");

ALTER TABLE "franchise_penalty_approvals"
  ADD CONSTRAINT "franchise_penalty_approvals_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
