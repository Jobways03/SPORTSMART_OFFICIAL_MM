-- Phase 155 (2026-05-26) — Affiliate Payout Approval & Execution audit.
-- Persist the actor on mark-paid / mark-failed (approvedById already existed;
-- rejectedById came in Phase 154). + paid_at reporting index.
ALTER TABLE "affiliate_payout_requests" ADD COLUMN IF NOT EXISTS "paid_by_id" TEXT;
ALTER TABLE "affiliate_payout_requests" ADD COLUMN IF NOT EXISTS "failed_by_id" TEXT;
CREATE INDEX IF NOT EXISTS "affiliate_payout_requests_paid_at_idx"
  ON "affiliate_payout_requests" ("paid_at");
