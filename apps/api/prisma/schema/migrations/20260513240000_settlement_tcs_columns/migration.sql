-- Phase 17 GST — Settlement-side TCS columns.
--
-- Adds the per-settlement TCS deduction snapshot so the payout amount
-- displayed to the seller equals (totalSettlementAmount − tcsDeducted)
-- exactly, and the seller's GSTR-2A reconciliation has a one-to-one
-- match with the platform's GSTR-8 row.
--
-- The actual TCS amounts + lifecycle live in
-- `gst_tcs_settlement_ledger`; this table stores a foreign-key pointer
-- + denormalised paise amount + the historical rate snapshot for
-- payout-statement rendering without a join.

ALTER TABLE "seller_settlements"
  ADD COLUMN IF NOT EXISTS "tcs_ledger_id" TEXT,
  ADD COLUMN IF NOT EXISTS "tcs_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tcs_rate_bps_snapshot" INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "tcs_filing_period" TEXT;

-- Cross-link to the TCS ledger row this settlement collected against.
DO $$
BEGIN
  ALTER TABLE "seller_settlements"
    ADD CONSTRAINT "seller_settlements_tcs_ledger_id_fkey"
    FOREIGN KEY ("tcs_ledger_id")
    REFERENCES "gst_tcs_settlement_ledger"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- Index drives the admin "settlements pending TCS collection" query
-- (WHERE tcs_ledger_id IS NULL AND status = 'APPROVED').
CREATE INDEX IF NOT EXISTS "seller_settlements_tcs_ledger_id_idx"
  ON "seller_settlements" ("tcs_ledger_id")
  WHERE "tcs_ledger_id" IS NOT NULL;
