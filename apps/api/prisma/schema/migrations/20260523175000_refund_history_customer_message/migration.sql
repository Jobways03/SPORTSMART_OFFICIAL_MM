-- Phase 106 (2026-05-23) — Phase 101 #28 + Phase 102 #14 closures.
--
--   refund_failure_history JSONB — bounded history of last 10
--     failure reasons; admin UI surfaces without joining
--     refund_transactions.
--
--   refund_failure_message_customer — sanitized, customer-safe mirror
--     of refund_failure_reason. Customer endpoints return only this
--     field; admin endpoints get the raw reason.

ALTER TABLE "returns"
  ADD COLUMN "refund_failure_history"            JSONB,
  ADD COLUMN "refund_failure_message_customer"   TEXT;
