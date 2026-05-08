-- Phase 13 (Returns industry-grade — Batch 3, P1.8): seller-response
-- lifecycle on returns. When a return is filed alleging seller fault
-- (DEFECTIVE / WRONG_ITEM / NOT_AS_DESCRIBED / QUALITY_ISSUE), the
-- seller is given a window to respond — accept the claim or contest
-- it with evidence. If they don't respond by `seller_response_due_at`,
-- the cron flips PENDING → EXPIRED and the QC step defaults to
-- seller liability (mirrors industry practice on Amazon / Flipkart).
--
-- Reasons that are obviously NOT seller fault (CHANGED_MIND,
-- SIZE_FIT_ISSUE) skip this entirely with status NOT_REQUIRED.
-- DAMAGED_IN_TRANSIT also skips because the courier-fault attribution
-- routes through LogisticsClaim, not SellerDebit.

CREATE TYPE "SellerResponseStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'ACCEPTED',
  'CONTESTED',
  'EXPIRED'
);

ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "seller_response_status"  "SellerResponseStatus",
  ADD COLUMN IF NOT EXISTS "seller_notified_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "seller_response_due_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "seller_responded_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "seller_response_notes"   TEXT;

-- Index covering the two queries we'll run repeatedly:
--   1. cron: PENDING + due_at < now → EXPIRED
--   2. seller dashboard: my returns where status = PENDING / CONTESTED
CREATE INDEX IF NOT EXISTS "returns_seller_response_status_due_at_idx"
  ON "returns" ("seller_response_status", "seller_response_due_at");
