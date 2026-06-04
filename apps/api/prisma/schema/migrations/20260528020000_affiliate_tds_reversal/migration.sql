-- Phase 160 (§194-O affiliate TDS lifecycle audit — #16).
--
-- Correction flow for the affiliate §194-O ledger. A row can be REVERSED
-- from any non-REVERSED state (a wrong deduction discovered after the
-- challan deposit, a duplicate, etc.). The reversal reason lives on a
-- dedicated column (not overloaded onto another field) alongside the
-- actor + timestamp; the cross-module audit_logs row carries the same.
--
-- REVERSED is already a value of the shared Tds194OStatus enum (used by
-- the seller §194-O ledger), so no enum change is needed — only the three
-- nullable metadata columns.

ALTER TABLE "affiliate_tds_194o_ledger"
  ADD COLUMN "reversed_at"     TIMESTAMP(3),
  ADD COLUMN "reversed_by"     TEXT,
  ADD COLUMN "reversal_reason" TEXT;
