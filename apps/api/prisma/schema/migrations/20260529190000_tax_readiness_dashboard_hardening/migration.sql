-- Phase 163 — Tax Audit Readiness Dashboard audit remediation.
--
-- #7  Indexes backing the readiness scans' hot predicates so a growing
--     marketplace doesn't turn the 14-scan dashboard load into a pile of
--     sequential full-table scans.
-- #16 tax_readiness_snapshots — the trend/history table the 6-hourly
--     readiness-snapshot cron writes.

-- ── #7 indexes ──────────────────────────────────────────────────────

-- TaxDocument: `einvoiceStatus IN (...) AND einvoiceRetryCount >= N`
CREATE INDEX IF NOT EXISTS "tax_documents_einvoice_status_retry_idx"
  ON "tax_documents" ("einvoice_status", "einvoice_retry_count");

-- TaxDocument: `status IN ('PDF_PENDING','PDF_FAILED') AND pdfRetryCount >= N`
CREATE INDEX IF NOT EXISTS "tax_documents_status_pdf_retry_idx"
  ON "tax_documents" ("status", "pdf_retry_count");

-- GstTcsSettlementLedger: `status IN ('COMPUTED','COLLECTED') AND filingPeriod <= cutoff`
CREATE INDEX IF NOT EXISTS "gst_tcs_settlement_ledger_status_period_idx"
  ON "gst_tcs_settlement_ledger" ("status", "filing_period");

-- Return: `creditNoteEligibilityStatus = 'REQUIRES_FINANCE_REVIEW'`
CREATE INDEX IF NOT EXISTS "returns_credit_note_eligibility_status_idx"
  ON "returns" ("credit_note_eligibility_status");

-- ── #16 readiness snapshot table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tax_readiness_snapshots" (
  "id"                TEXT NOT NULL,
  "current_mode"      TEXT NOT NULL,
  "ready"             BOOLEAN NOT NULL,
  "total_blockers"    INTEGER NOT NULL,
  "critical_blockers" INTEGER NOT NULL DEFAULT 0,
  "blockers_json"     JSONB NOT NULL,
  "generated_at"      TIMESTAMP(3) NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_readiness_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tax_readiness_snapshots_generated_at_idx"
  ON "tax_readiness_snapshots" ("generated_at" DESC);
