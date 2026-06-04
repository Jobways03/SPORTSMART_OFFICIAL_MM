-- Phase 167 — Razorpay Refund Execution flow audit remediation.
--
-- #7  SETTLED status + settled_at — Razorpay `processed` (debited from our
--     balance) vs `settled` (bank credited the customer); the refund.settled
--     webhook now records true settlement.
-- #8  per-instruction gateway-reconciliation poll tracking (last_polled_at /
--     poll_attempt_count / last_poll_error) so the recon cron backs off.
-- #6  partial-unique on refund_instructions.gateway_refund_id (one instruction
--     per refund). NOTE: refund_transactions.gateway_refund_id is deliberately
--     NOT made unique — the retry-with-gateway-idempotency design legitimately
--     writes the SAME provider refund id across attempt rows (Razorpay returns
--     the existing refund on replay), so a unique there would break a correct flow.
-- #18 partial-unique on returns.refund_reference (one gateway refund per return).

-- #7 — enum value (PG 12+ allows ADD VALUE in a tx as long as it isn't used here).
ALTER TYPE "RefundInstructionStatus" ADD VALUE IF NOT EXISTS 'SETTLED';

-- #7/#8 — columns.
ALTER TABLE "refund_instructions"
  ADD COLUMN IF NOT EXISTS "settled_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_polled_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "poll_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_poll_error"    TEXT;

-- #6 — one RefundInstruction per gateway refund id.
CREATE UNIQUE INDEX IF NOT EXISTS "refund_instructions_gateway_refund_id_unique"
  ON "refund_instructions" ("gateway_refund_id")
  WHERE "gateway_refund_id" IS NOT NULL;

-- #18 — one gateway refund per return.
CREATE UNIQUE INDEX IF NOT EXISTS "returns_refund_reference_unique"
  ON "returns" ("refund_reference")
  WHERE "refund_reference" IS NOT NULL;

-- #8 — back the recon backoff scan (PROCESSING + gatewayRefundId + last_polled_at).
CREATE INDEX IF NOT EXISTS "refund_instructions_recon_poll_idx"
  ON "refund_instructions" ("status", "last_polled_at")
  WHERE "gateway_refund_id" IS NOT NULL;
