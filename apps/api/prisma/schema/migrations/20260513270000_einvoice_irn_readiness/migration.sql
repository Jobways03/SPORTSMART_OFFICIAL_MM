-- Phase 22 GST — E-invoice / IRN readiness.
--
-- CBIC Rule 48(4): from Aug 2023, businesses with aggregate annual
-- turnover > ₹5 crore must e-invoice every B2B supply via the NIC IRP
-- (Invoice Registration Portal). Below the threshold the seller may
-- still opt in voluntarily.
--
-- Phase 22 ships the schema additions + stub adapter so the system
-- shape is end-to-end ready. NIC integration itself lands in the
-- production rollout (the stub crashes loudly on `nic` provider).
--
-- Tax-document additions:
--   - einvoice_retry_count       — incremented on every failed attempt.
--   - einvoice_last_attempted_at — drives the cron's cooldown predicate.
--   - einvoice_failure_reason    — captured on failure; cleared on success.
--   - einvoice_provider          — 'stub' / 'nic'; persisted per row so
--     a future provider swap doesn't lose attribution.
--
-- SellerGstin additions:
--   - aggregate_turnover_in_paise — captured per seller-GSTIN so the
--     applicability check ("are you above ₹5 crore?") is data-driven,
--     not a guess. Updated by the seller's annual return upload.
--   - einvoice_opted_in           — explicit voluntary opt-in; lets
--     sub-threshold sellers route through NIC IRP if they want.

ALTER TABLE "tax_documents"
  ADD COLUMN IF NOT EXISTS "einvoice_retry_count"       INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "einvoice_last_attempted_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "einvoice_failure_reason"    TEXT,
  ADD COLUMN IF NOT EXISTS "einvoice_provider"          TEXT;

ALTER TABLE "seller_gstins"
  ADD COLUMN IF NOT EXISTS "aggregate_turnover_in_paise" BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "einvoice_opted_in"           BOOLEAN NOT NULL DEFAULT false;

-- Partial index drives the retry cron: status IN (PENDING, FAILED) AND
-- retry_count < N AND last_attempted_at < (now - cooldown). The cron
-- applies the rest of the predicate.
CREATE INDEX IF NOT EXISTS "tax_documents_einvoice_retry_idx"
  ON "tax_documents" ("einvoice_status", "einvoice_retry_count", "einvoice_last_attempted_at")
  WHERE "einvoice_status" IN ('PENDING', 'FAILED');

-- New AdminTaskKind values for the e-invoice workflow.
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'EINVOICE_GENERATION_FAILED';
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'EINVOICE_CANCELLATION_FAILED';
