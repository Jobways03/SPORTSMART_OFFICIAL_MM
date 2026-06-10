-- Phase 250 (Franchise tax) — mirror the seller tax stack onto the franchise
-- settlement path by (a) adding TCS/TDS/commission-GST deduction snapshot
-- columns to franchise_settlements and (b) generalizing the §52 TCS and §194-O
-- TDS statutory ledgers to be party-aware (seller OR franchise).
--
-- Hand-authored (not `migrate dev`): the dev DB has pre-existing drift vs the
-- Prisma migration history, so a full `migrate diff` sweeps in dozens of
-- unrelated rename/type changes. This migration contains ONLY the Phase-250
-- franchise-tax changes.

-- ── FranchiseSettlement: TCS / TDS / commission-GST deduction snapshots ──────
ALTER TABLE "franchise_settlements"
  ADD COLUMN "tcs_ledger_id" TEXT,
  ADD COLUMN "tcs_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "tcs_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "tcs_filing_period" TEXT,
  ADD COLUMN "tds_ledger_id" TEXT,
  ADD COLUMN "tds_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "tds_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "tds_filing_period" TEXT,
  ADD COLUMN "tds_skip_reason" TEXT,
  ADD COLUMN "commission_gst_rate_bps" INTEGER NOT NULL DEFAULT 1800,
  ADD COLUMN "commission_gst_split_type" TEXT,
  ADD COLUMN "cgst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "sgst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "igst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "total_commission_gst_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "commission_gst_marketplace_state_code" TEXT,
  ADD COLUMN "commission_gst_franchise_state_code" TEXT;

-- ── GstTcsSettlementLedger (§52): party generalization ──────────────────────
-- party_type defaults to MARKETPLACE_SELLER so existing rows are correctly
-- classified without a separate backfill statement.
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "franchise_id" TEXT,
  ADD COLUMN "party_type" "SupplierType" NOT NULL DEFAULT 'MARKETPLACE_SELLER';

-- ── Section194OTdsLedger (§194-O): party generalization + nullable seller ────
ALTER TABLE "section_194o_tds_ledger"
  ADD COLUMN "franchise_id" TEXT,
  ADD COLUMN "party_type" "SupplierType" NOT NULL DEFAULT 'MARKETPLACE_SELLER';
ALTER TABLE "section_194o_tds_ledger" ALTER COLUMN "seller_id" DROP NOT NULL;

-- ── Lookup indexes (non-unique) ─────────────────────────────────────────────
CREATE INDEX "gst_tcs_settlement_ledger_franchise_id_filing_period_idx"
  ON "gst_tcs_settlement_ledger"("franchise_id", "filing_period");
CREATE INDEX "section_194o_tds_ledger_franchise_id_filing_period_idx"
  ON "section_194o_tds_ledger"("franchise_id", "filing_period");

-- ── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD CONSTRAINT "gst_tcs_settlement_ledger_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "section_194o_tds_ledger"
  ADD CONSTRAINT "section_194o_tds_ledger_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "franchise_settlements"
  ADD CONSTRAINT "franchise_settlements_tcs_ledger_id_fkey"
  FOREIGN KEY ("tcs_ledger_id") REFERENCES "gst_tcs_settlement_ledger"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "franchise_settlements"
  ADD CONSTRAINT "franchise_settlements_tds_ledger_id_fkey"
  FOREIGN KEY ("tds_ledger_id") REFERENCES "section_194o_tds_ledger"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Per-party active-row partial uniques (mirror the seller-side guard) ──────
-- One non-REVERSED §52 TCS row per (franchise, month).
CREATE UNIQUE INDEX "gst_tcs_ledger_franchise_period_active_unique"
  ON "gst_tcs_settlement_ledger"("franchise_id", "filing_period")
  WHERE "status" <> 'REVERSED' AND "franchise_id" IS NOT NULL;
-- One non-REVERSED §194-O TDS row per (franchise, quarter).
CREATE UNIQUE INDEX "tds_194o_ledger_franchise_period_active_unique"
  ON "section_194o_tds_ledger"("franchise_id", "filing_period")
  WHERE "status" <> 'REVERSED' AND "franchise_id" IS NOT NULL;
