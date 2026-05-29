-- Phase 116 — finance reporting index. Without it, "refunds by method"
-- (and "bank-transfer refunds awaiting approval") full-scan refund_instructions.
CREATE INDEX "refund_instructions_refund_method_status_idx"
  ON "refund_instructions"("refund_method", "status");
