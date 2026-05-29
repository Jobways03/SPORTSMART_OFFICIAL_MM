-- Phase 159f (2026-05-27) — Affiliate TDS deposit + Form 16A certificate
-- lifecycle on the §194-O ledger (mirrors the seller Section194OTdsLedger).
ALTER TABLE "affiliate_tds_194o_ledger"
  ADD COLUMN IF NOT EXISTS "deposited_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deposited_by" TEXT,
  ADD COLUMN IF NOT EXISTS "challan_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "certificate_issued_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "certificate_issued_by" TEXT,
  ADD COLUMN IF NOT EXISTS "certificate_number" TEXT;
