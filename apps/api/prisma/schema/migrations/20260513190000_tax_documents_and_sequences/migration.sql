-- Phase 8 of the GST/tax/invoice system — tax document model.
--
-- See docs/tax/CA.md §A Phase 8 log + §2.1 + §5 (PDF drafts).
-- Schema only; generation service ships in Phase 9.

CREATE TYPE "DocumentType" AS ENUM (
  'TAX_INVOICE',
  'BILL_OF_SUPPLY',
  'INVOICE_CUM_BILL_OF_SUPPLY',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'LEGACY_RECEIPT'
);

CREATE TYPE "InvoiceType" AS ENUM ('B2C', 'B2B');

CREATE TYPE "TaxDocumentStatus" AS ENUM (
  'DRAFT',
  'GENERATED',
  'PDF_PENDING',
  'PDF_GENERATED',
  'PDF_FAILED',
  'PARTIALLY_REVERSED',
  'FULLY_REVERSED',
  'SUPERSEDED',
  'VOIDED_DRAFT'
);

CREATE TYPE "EInvoiceStatus" AS ENUM (
  'NOT_APPLICABLE',
  'PENDING',
  'GENERATED',
  'FAILED'
);

CREATE TABLE "tax_documents" (
  "id"                          TEXT NOT NULL,
  "document_number"             TEXT NOT NULL,
  "document_type"               "DocumentType" NOT NULL,
  "financial_year"              TEXT NOT NULL,

  "master_order_id"             TEXT,
  "sub_order_id"                TEXT,
  "seller_id"                   TEXT,
  "customer_id"                 TEXT NOT NULL,
  "supplier_type"               "SupplierType" NOT NULL,
  "invoice_type"                "InvoiceType",

  "supplier_gstin"              TEXT,
  "seller_registration_type"    "GstRegistrationType",
  "seller_legal_name"           TEXT,
  "seller_address_json"         JSONB,
  "seller_state_code"           TEXT,

  "buyer_gstin"                 TEXT,
  "buyer_legal_name"            TEXT,
  "billing_address_json"        JSONB,
  "shipping_address_json"       JSONB,
  "place_of_supply_state_code"  TEXT,

  "reverse_charge_applicable"   BOOLEAN NOT NULL DEFAULT false,
  "reverse_charge_reason"       TEXT,

  "taxable_amount_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "cgst_amount_in_paise"        BIGINT NOT NULL DEFAULT 0,
  "sgst_amount_in_paise"        BIGINT NOT NULL DEFAULT 0,
  "igst_amount_in_paise"        BIGINT NOT NULL DEFAULT 0,
  "total_tax_amount_in_paise"   BIGINT NOT NULL DEFAULT 0,
  "cess_amount_in_paise"        BIGINT NOT NULL DEFAULT 0,
  "round_off_amount_in_paise"   BIGINT NOT NULL DEFAULT 0,
  "document_total_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "amount_in_words"             TEXT,
  "currency_code"               TEXT NOT NULL DEFAULT 'INR',
  "payment_mode"                TEXT,

  "original_document_id"        TEXT,
  "original_document_number"    TEXT,
  "reason"                      TEXT,

  "status"                      "TaxDocumentStatus" NOT NULL DEFAULT 'DRAFT',

  "pdf_url"                     TEXT,
  "pdf_storage_path"            TEXT,
  "pdf_sha_256"                 TEXT,
  "download_count"              INTEGER NOT NULL DEFAULT 0,
  "last_downloaded_at"          TIMESTAMP(3),

  "irn"                         TEXT,
  "ack_no"                      TEXT,
  "ack_date"                    TIMESTAMP(3),
  "signed_document_json"        JSONB,
  "qr_code_url"                 TEXT,
  "einvoice_status"             "EInvoiceStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',

  "generated_at"                TIMESTAMP(3),
  "cancelled_at"                TIMESTAMP(3),
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tax_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_documents_supplier_fy_type_num_uniq"
  ON "tax_documents"("supplier_gstin", "financial_year", "document_type", "document_number");
CREATE INDEX "tax_documents_master_order_id_idx"  ON "tax_documents"("master_order_id");
CREATE INDEX "tax_documents_sub_order_id_idx"     ON "tax_documents"("sub_order_id");
CREATE INDEX "tax_documents_seller_id_idx"        ON "tax_documents"("seller_id");
CREATE INDEX "tax_documents_customer_id_idx"      ON "tax_documents"("customer_id");
CREATE INDEX "tax_documents_document_type_idx"    ON "tax_documents"("document_type");
CREATE INDEX "tax_documents_status_idx"           ON "tax_documents"("status");
CREATE INDEX "tax_documents_financial_year_idx"   ON "tax_documents"("financial_year");
CREATE INDEX "tax_documents_generated_at_idx"     ON "tax_documents"("generated_at");
CREATE INDEX "tax_documents_buyer_gstin_idx"      ON "tax_documents"("buyer_gstin");

CREATE TABLE "tax_document_lines" (
  "id"                       TEXT NOT NULL,
  "document_id"              TEXT NOT NULL,
  "source_snapshot_id"       TEXT,
  "line_number"              INTEGER NOT NULL,
  "line_type"                "TaxLineType" NOT NULL,

  "product_id"               TEXT,
  "variant_id"               TEXT,
  "product_name"             TEXT NOT NULL,
  "sku"                      TEXT,
  "hsn_or_sac_code"          TEXT,
  "uqc_code"                 TEXT,
  "quantity"                 DECIMAL(12, 3) NOT NULL,
  "unit_price_in_paise"      BIGINT NOT NULL,

  "gross_amount_in_paise"    BIGINT NOT NULL DEFAULT 0,
  "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
  "taxable_amount_in_paise"  BIGINT NOT NULL DEFAULT 0,
  "gst_rate_bps"             INTEGER NOT NULL DEFAULT 0,
  "cgst_amount_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "sgst_amount_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "igst_amount_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
  "cess_amount_in_paise"     BIGINT NOT NULL DEFAULT 0,
  "line_total_in_paise"      BIGINT NOT NULL DEFAULT 0,
  "currency_code"            TEXT NOT NULL DEFAULT 'INR',

  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_document_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_document_lines_doc_line_num_uniq"
  ON "tax_document_lines"("document_id", "line_number");
CREATE INDEX "tax_document_lines_document_id_idx"        ON "tax_document_lines"("document_id");
CREATE INDEX "tax_document_lines_source_snapshot_id_idx" ON "tax_document_lines"("source_snapshot_id");
CREATE INDEX "tax_document_lines_line_type_idx"          ON "tax_document_lines"("line_type");

ALTER TABLE "tax_document_lines"
  ADD CONSTRAINT "tax_document_lines_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "tax_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document_sequences" (
  "id"               TEXT NOT NULL,
  "sequence_key"     TEXT NOT NULL,
  "supplier_gstin"   TEXT,
  "financial_year"   TEXT NOT NULL,
  "document_type"    "DocumentType" NOT NULL,
  "prefix"           TEXT NOT NULL,
  "last_number"      INTEGER NOT NULL DEFAULT 0,
  "skipped_numbers"  JSONB NOT NULL DEFAULT '[]',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_sequences_sequence_key_key" ON "document_sequences"("sequence_key");
CREATE INDEX "document_sequences_supplier_fy_type_idx"
  ON "document_sequences"("supplier_gstin", "financial_year", "document_type");
