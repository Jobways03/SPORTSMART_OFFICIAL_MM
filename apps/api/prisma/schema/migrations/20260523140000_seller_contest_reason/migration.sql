-- Phase 95 (2026-05-23) — Phase 94 deferred closures.
--
-- 1) sellerContestReasonCategory — structured contest reason for
--    analytics + admin dashboards. Free-text seller notes stay; this
--    column is the categorical signal that drives "top contest
--    reasons by seller" reports.
--
-- 2) seller_response_extended_* — admin extension audit pointer. Pre-
--    Phase-95 the only way to lengthen the seller-response window was
--    a direct DB UPDATE; we now persist who granted the extension +
--    when so audits can distinguish "seller responded inside their
--    original window" from "seller responded only because admin
--    moved the goalpost".

ALTER TABLE "returns"
  ADD COLUMN "seller_contest_reason_category"   TEXT,
  ADD COLUMN "seller_response_extended_by"      TEXT,
  ADD COLUMN "seller_response_extended_at"      TIMESTAMP(3),
  ADD COLUMN "seller_response_extension_hours"  INTEGER;
