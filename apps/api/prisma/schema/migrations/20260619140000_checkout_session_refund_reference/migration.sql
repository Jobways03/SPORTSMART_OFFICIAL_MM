-- Option B (deferred order creation) — Phase 5.
-- Additive only: gateway refund id stamped by the reconciler on FAILED-session auto-refund.

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN "refund_reference" TEXT;
