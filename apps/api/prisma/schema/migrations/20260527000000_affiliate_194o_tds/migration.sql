-- Phase 159e (2026-05-27) — Affiliate Payout TDS §194-O.
--   - settings: section toggle + PAN-aware bps rates (§194H rate still read
--     from tds_rate, fixing the hardcoded-0.10 bug).
--   - payout request: frozen §194-O snapshot (section/rate/PAN/quarter).
--   - per-payout §194-O ledger for Form 26Q (quarter-tagged, PAN-snapshotted).

ALTER TABLE "affiliate_settings"
  ADD COLUMN IF NOT EXISTS "tds_section" TEXT NOT NULL DEFAULT '194O',
  ADD COLUMN IF NOT EXISTS "tds_rate_with_pan_bps" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "tds_rate_without_pan_bps" INTEGER NOT NULL DEFAULT 500;

ALTER TABLE "affiliate_payout_requests"
  ADD COLUMN IF NOT EXISTS "tds_section" TEXT NOT NULL DEFAULT '194O',
  ADD COLUMN IF NOT EXISTS "tds_rate_bps" INTEGER,
  ADD COLUMN IF NOT EXISTS "pan_on_file_at_deduction" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "filing_quarter" TEXT;

CREATE TABLE IF NOT EXISTS "affiliate_tds_194o_ledger" (
  "id" TEXT NOT NULL,
  "affiliate_id" TEXT NOT NULL,
  "payout_request_id" TEXT NOT NULL,
  "filing_period" TEXT NOT NULL,
  "pan_last4" TEXT,
  "had_pan_on_file" BOOLEAN NOT NULL DEFAULT false,
  "gross_in_paise" BIGINT NOT NULL,
  "tds_in_paise" BIGINT NOT NULL,
  "tds_rate_bps" INTEGER NOT NULL,
  "status" "Tds194OStatus" NOT NULL DEFAULT 'COMPUTED',
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withheld_at" TIMESTAMP(3),
  "filed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_tds_194o_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_tds_194o_ledger_payout_request_id_key"
  ON "affiliate_tds_194o_ledger" ("payout_request_id");
CREATE INDEX IF NOT EXISTS "affiliate_tds_194o_ledger_filing_period_idx"
  ON "affiliate_tds_194o_ledger" ("filing_period");
CREATE INDEX IF NOT EXISTS "affiliate_tds_194o_ledger_affiliate_id_filing_period_idx"
  ON "affiliate_tds_194o_ledger" ("affiliate_id", "filing_period");
CREATE INDEX IF NOT EXISTS "affiliate_tds_194o_ledger_status_filing_period_idx"
  ON "affiliate_tds_194o_ledger" ("status", "filing_period");

ALTER TABLE "affiliate_tds_194o_ledger"
  ADD CONSTRAINT "affiliate_tds_194o_ledger_affiliate_id_fkey"
  FOREIGN KEY ("affiliate_id") REFERENCES "affiliates" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_tds_194o_ledger"
  ADD CONSTRAINT "affiliate_tds_194o_ledger_payout_request_id_fkey"
  FOREIGN KEY ("payout_request_id") REFERENCES "affiliate_payout_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
