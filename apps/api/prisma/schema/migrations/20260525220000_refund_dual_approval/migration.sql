-- Phase 125 — dual-approval (two-person rule) for high-value refunds.
-- The first finance approver is recorded here; a second, distinct approver
-- populates approved_by and releases the refund saga. Below the dual-approval
-- threshold these stay NULL and a single approved_by is sufficient.
ALTER TABLE "refund_instructions" ADD COLUMN "first_approved_by" TEXT;
ALTER TABLE "refund_instructions" ADD COLUMN "first_approved_at" TIMESTAMP(3);
