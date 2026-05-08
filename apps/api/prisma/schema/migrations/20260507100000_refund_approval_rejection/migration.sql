-- Phase 12 (ADR-017) — Finance approval gate on refunds.
--
-- The PENDING_APPROVAL status + approvedBy/At columns already exist
-- (added in 20260505140000 as a forward-looking placeholder). This
-- migration adds the rejection-side fields so the queue UI can
-- record an explicit reject action with reason + actor — same shape
-- as approval, opposite direction.

ALTER TABLE "refund_instructions"
  ADD COLUMN "rejected_by"      TEXT,
  ADD COLUMN "rejected_at"      TIMESTAMP(3),
  ADD COLUMN "rejection_reason" TEXT;
