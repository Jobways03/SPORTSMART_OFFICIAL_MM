-- Phase 159g (2026-05-27) — CBDT Form 26Q upload fields on the affiliate
-- §194-O ledger: BSR code of the bank branch + challan date.
ALTER TABLE "affiliate_tds_194o_ledger"
  ADD COLUMN IF NOT EXISTS "bsr_code" TEXT,
  ADD COLUMN IF NOT EXISTS "challan_date" TIMESTAMP(3);
