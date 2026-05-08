-- Phase 13 (Returns industry-grade — Batch 1): record liability +
-- customer remedy on the return itself, so the liability ledger
-- (SellerDebit / LogisticsClaim / PlatformExpense) can be written
-- straight from QC without going through a dispute. Mirrors the
-- columns ADR-016 added to disputes; reuses the same enums via
-- Prisma so the matrix stays consistent across modules.

ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "liability_party"   "LiabilityParty",
  ADD COLUMN IF NOT EXISTS "customer_remedy"   "CustomerRemedy",
  ADD COLUMN IF NOT EXISTS "qc_rationale"      TEXT,
  ADD COLUMN IF NOT EXISTS "qc_internal_notes" TEXT,
  -- Optional courier metadata captured at QC time when liability=LOGISTICS.
  -- Keeps the LogisticsClaim row's evidence pointer-rich without forcing
  -- a separate UI step.
  ADD COLUMN IF NOT EXISTS "qc_courier_name" TEXT,
  ADD COLUMN IF NOT EXISTS "qc_awb_number"   TEXT;

-- Indexes only on the columns that will be filtered in admin UIs.
-- qc_rationale / qc_internal_notes / qc_courier_name / qc_awb_number
-- are read-once-on-detail; no index needed.
CREATE INDEX IF NOT EXISTS "returns_liability_party_idx"
  ON "returns" ("liability_party");
CREATE INDEX IF NOT EXISTS "returns_customer_remedy_idx"
  ON "returns" ("customer_remedy");
