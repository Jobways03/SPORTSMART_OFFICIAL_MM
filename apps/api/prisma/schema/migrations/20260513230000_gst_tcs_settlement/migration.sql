-- Phase 16 GST — TCS (Section 52) settlement ledger.
--
-- One row per (sellerId, filingPeriod) capturing the computed TCS
-- amounts and their lifecycle status. Drives:
--   - Settlement payout deduction (seller payable −= totalTcs)
--   - GSTR-8 monthly export (per CBIC schema)
--   - Audit trail (computedBy, computedReason, markedFiledAt, etc.)
--
-- The "net taxable supply" aggregation is computed dynamically from
-- existing `tax_documents`, not stored in a separate gst_collection_ledger.
-- We snapshot the aggregate amounts here at compute time so a later
-- correction doesn't silently change the filed values.
--
-- See docs/tax/TCS_POLICY.md for the operational policy.

DO $$
BEGIN
  CREATE TYPE "TcsStatus" AS ENUM (
    -- Computed at settlement-run time; ready for settlement deduction.
    'COMPUTED',
    -- Settlement has deducted the TCS amount from the seller's payout.
    'COLLECTED',
    -- Included in a filed GSTR-8 (admin marked-filed after upload).
    'FILED',
    -- TCS amount remitted to the government (admin marked-paid).
    'PAID_TO_GOVT',
    -- Reversed via correction (super-rare; correctionOfId points back
    -- to the original row).
    'REVERSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- New AdminTaskKind values for TCS workflows.
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'GSTR8_FILING_DUE';
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'TCS_COMPUTATION_FAILED';

CREATE TABLE IF NOT EXISTS "gst_tcs_settlement_ledger" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  -- (sellerId, filingPeriod) is the business key. NULL sellerId is
  -- reserved for platform-direct supplies (excluded from TCS per
  -- TCS_POLICY §2) — we keep the column nullable for future flexibility
  -- but the UNIQUE INDEX below treats NULL as distinct.
  "seller_id"      TEXT,
  -- "YYYY-MM" — calendar-month, not financial-year. Per CBIC GSTR-8
  -- filing is monthly.
  "filing_period"  TEXT NOT NULL,

  -- Snapshot of the supplier's GSTIN + state at computation time.
  -- Captured here so a later seller-side GSTIN change doesn't rewrite
  -- the filed history.
  "supplier_gstin"      TEXT,
  "supplier_state_code" TEXT,

  -- Aggregates (paise) at computation time. Splits between
  -- intra-state and inter-state are derived from the constituent
  -- invoices; we snapshot both totals + the TCS amounts separately.
  "gross_taxable_supply_in_paise"      BIGINT NOT NULL DEFAULT 0,
  "credit_note_reversal_in_paise"      BIGINT NOT NULL DEFAULT 0,
  "net_taxable_supply_in_paise"        BIGINT NOT NULL DEFAULT 0,

  -- Split of the net taxable supply between intra-state (CGST+SGST
  -- TCS at 0.5% each) and inter-state (IGST TCS at 1%).
  "intra_state_taxable_in_paise"       BIGINT NOT NULL DEFAULT 0,
  "inter_state_taxable_in_paise"       BIGINT NOT NULL DEFAULT 0,

  -- Computed TCS amounts (paise). Historical TCS rate snapshot for
  -- audit so a rate change later doesn't rewrite the past.
  "tcs_rate_bps"               INT    NOT NULL DEFAULT 100,
  "cgst_tcs_in_paise"          BIGINT NOT NULL DEFAULT 0,
  "sgst_tcs_in_paise"          BIGINT NOT NULL DEFAULT 0,
  "igst_tcs_in_paise"          BIGINT NOT NULL DEFAULT 0,
  "total_tcs_in_paise"         BIGINT NOT NULL DEFAULT 0,

  -- When net taxable supply is negative (credit notes in the period
  -- exceed invoices), TCS clamps at zero and the excess carries
  -- forward to the next period. Captured here for the next compute
  -- pass to consume.
  "adjustment_carried_forward_in_paise" BIGINT NOT NULL DEFAULT 0,

  "status" "TcsStatus" NOT NULL DEFAULT 'COMPUTED',

  -- Lifecycle stamps + audit trail.
  "computed_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "computed_by"      TEXT,
  "computed_reason"  TEXT,
  "collected_at"     TIMESTAMPTZ,
  "settlement_id"    TEXT,
  "filed_at"         TIMESTAMPTZ,
  "filed_by"         TEXT,
  "paid_to_govt_at"  TIMESTAMPTZ,
  "paid_by"          TEXT,
  "payment_reference" TEXT,

  -- Correction lineage. A REVERSED row is followed by a corrected
  -- replacement; the new row's `correction_of_id` points back to
  -- the reversed predecessor so audit can replay.
  "correction_of_id" TEXT,

  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "gst_tcs_settlement_ledger_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────
-- One ACTIVE (non-REVERSED) row per (sellerId, filingPeriod). A
-- corrected row sits alongside the REVERSED original; the partial
-- UNIQUE keeps the lookup unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "gst_tcs_settlement_ledger_seller_period_active_uniq"
  ON "gst_tcs_settlement_ledger" ("seller_id", "filing_period")
  WHERE "status" != 'REVERSED';

CREATE INDEX IF NOT EXISTS "gst_tcs_settlement_ledger_filing_period_idx"
  ON "gst_tcs_settlement_ledger" ("filing_period");
CREATE INDEX IF NOT EXISTS "gst_tcs_settlement_ledger_status_idx"
  ON "gst_tcs_settlement_ledger" ("status");
CREATE INDEX IF NOT EXISTS "gst_tcs_settlement_ledger_supplier_gstin_idx"
  ON "gst_tcs_settlement_ledger" ("supplier_gstin");

-- ── Foreign keys ─────────────────────────────────────────────────
-- Seller FK is nullable + RESTRICT — a seller cannot be deleted
-- while they have TCS history. The correction link is intentionally
-- not FK-enforced (the parent might pre-exist before the schema land,
-- or the correction might be a new ID with no predecessor in some
-- backfill scenarios).
DO $$
BEGIN
  ALTER TABLE "gst_tcs_settlement_ledger"
    ADD CONSTRAINT "gst_tcs_settlement_ledger_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
