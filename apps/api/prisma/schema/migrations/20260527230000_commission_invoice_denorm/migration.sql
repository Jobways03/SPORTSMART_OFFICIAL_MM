-- Phase 159aa (Marketplace Commission GSTR-1 audit remediation).
--
-- Closes the four critical findings on the marketplace's own GSTR-1
-- commission export by adding a per-settlement commission-invoice
-- snapshot. The CBIC §31 obligation to issue a tax invoice for every
-- B2B commission supply (B2), the per-invoice §4 B2B row contract
-- (B1), the §7 B2C bucket for non-GSTIN sellers (B3), and the explicit
-- supplier-GSTIN + place-of-supply + e-invoice IRN columns (#6, #11,
-- #12) all read from these new columns.
--
-- The columns are nullable / default-false so a deploy doesn't break
-- existing rows; freshly-approved cycles populate them via
-- CommissionInvoiceService.applyToCycleOnApprove(). The GSTR-1
-- exporter falls back to the legacy aggregator for pre-159aa rows.

ALTER TABLE "seller_settlements"
  ADD COLUMN "commission_invoice_number"                 TEXT,
  ADD COLUMN "commission_invoice_date"                   TIMESTAMP(3),
  ADD COLUMN "commission_invoice_filing_period"          TEXT,
  ADD COLUMN "commission_place_of_supply_state_code"     TEXT,
  ADD COLUMN "commission_invoice_supplier_gstin"         TEXT,
  ADD COLUMN "commission_invoice_recipient_gstin"        TEXT,
  ADD COLUMN "commission_recipient_is_b2c"               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "commission_invoice_sac_code"               TEXT,
  ADD COLUMN "commission_invoice_irn"                    TEXT,
  ADD COLUMN "commission_invoice_irn_ack_no"             TEXT,
  ADD COLUMN "commission_invoice_irn_ack_at"             TIMESTAMP(3),
  ADD COLUMN "commission_invoice_credit_note_for_id"     TEXT;

-- The GSTR-1 export filters by filing period equality; the index
-- supports that query at scale (~100k commission invoices / month).
CREATE INDEX "seller_settlements_commission_invoice_filing_period_idx"
  ON "seller_settlements" ("commission_invoice_filing_period");

-- Invoice numbers are globally unique by construction
-- (DocumentSequenceService key includes supplier GSTIN + FY + docType);
-- the partial-unique pins the contract at the DB layer so a race or
-- buggy backfill can't double-issue the same number. Partial because
-- legacy rows + pre-issuance rows have NULL.
CREATE UNIQUE INDEX "seller_settlements_commission_invoice_number_unique"
  ON "seller_settlements" ("commission_invoice_number")
  WHERE "commission_invoice_number" IS NOT NULL;

-- Seed the SAC + rate into tax_config so a future CBIC change updates
-- a single source (instead of a default-1800 hard-coded across the
-- settlement service, the calculator, and the CSV emit).
-- The keys are upserted so a re-run + manual override is preserved.
INSERT INTO "tax_config" ("id", "key", "value", "description", "updated_at", "created_at")
VALUES
  (gen_random_uuid()::text, 'commission_sac_code',
   '"9985"'::jsonb,
   'CBIC SAC code for e-commerce operator commission service supply.',
   NOW(), NOW()),
  (gen_random_uuid()::text, 'commission_gst_rate_bps',
   '1800'::jsonb,
   'GST rate (basis points) on the marketplace commission supply. 1800 = 18%.',
   NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
