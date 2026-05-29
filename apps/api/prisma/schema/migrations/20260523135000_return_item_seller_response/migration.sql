-- Phase 95 (2026-05-23) — Phase 94 deferred #20 closure.
--
-- Per-ReturnItem seller decision so multi-item returns can record
-- "I agree on item 1, contest item 2". The Return-level
-- sellerResponseStatus stays as the rollup: any CONTESTED at the item
-- level rolls up to CONTESTED at the return level, so admin/email
-- handlers don't need item-level awareness yet. The columns are
-- optional + nullable on legacy rows so existing data continues to
-- work. SellerContestReasonCategory in a separate migration also
-- supplements this for structured contest analysis.

ALTER TABLE "return_items"
  ADD COLUMN "seller_item_response"        TEXT,
  ADD COLUMN "seller_item_responded_at"    TIMESTAMP(3),
  ADD COLUMN "seller_item_response_note"   VARCHAR(2000);
