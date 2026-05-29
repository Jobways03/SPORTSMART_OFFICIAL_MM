-- Phase 152 (2026-05-26) — Bank Response Ingestion audit trail.
--   - BankResponseImport / BankResponseRow: system-of-record for every bank
--     response submission (file upload or manual), with raw-row forensics.
--   - Payout.bank_paid_amount_in_paise: the amount the bank reported (was only
--     in the failureReason text on a mismatch).
--   - Partial unique on (payout_batch_id, file_hash) blocks re-ingesting the
--     same file; NULL hashes (manual entries) are exempt.

CREATE TYPE "BankResponseSource" AS ENUM ('FILE_UPLOAD', 'MANUAL_ENTRY');

ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "bank_paid_amount_in_paise" BIGINT;

CREATE TABLE "bank_response_imports" (
  "id"                   TEXT NOT NULL,
  "payout_batch_id"      TEXT NOT NULL,
  "imported_by_admin_id" TEXT,
  "source"               "BankResponseSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
  "file_hash"            TEXT,
  "file_name"            TEXT,
  "row_count"            INTEGER NOT NULL DEFAULT 0,
  "success_count"        INTEGER NOT NULL DEFAULT 0,
  "fail_count"           INTEGER NOT NULL DEFAULT 0,
  "skipped_count"        INTEGER NOT NULL DEFAULT 0,
  "imported_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_response_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_response_rows" (
  "id"                        TEXT NOT NULL,
  "import_id"                 TEXT NOT NULL,
  "row_index"                 INTEGER NOT NULL,
  "raw_json"                  JSONB NOT NULL,
  "settlement_id"             TEXT,
  "outcome"                   TEXT NOT NULL,
  "utr_reference"             TEXT,
  "failure_reason"            TEXT,
  "bank_paid_amount_in_paise" BIGINT,
  "processed_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_response_rows_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bank_response_imports"
  ADD CONSTRAINT "bank_response_imports_payout_batch_id_fkey"
  FOREIGN KEY ("payout_batch_id") REFERENCES "payout_batches" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_response_rows"
  ADD CONSTRAINT "bank_response_rows_import_id_fkey"
  FOREIGN KEY ("import_id") REFERENCES "bank_response_imports" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "bank_response_imports_payout_batch_id_idx" ON "bank_response_imports" ("payout_batch_id");
CREATE INDEX "bank_response_imports_imported_by_admin_id_idx" ON "bank_response_imports" ("imported_by_admin_id");
CREATE INDEX "bank_response_rows_import_id_idx" ON "bank_response_rows" ("import_id");
CREATE INDEX "bank_response_rows_settlement_id_idx" ON "bank_response_rows" ("settlement_id");

-- Block re-ingesting the same file into the same batch (manual entries have a
-- NULL hash and are exempt).
CREATE UNIQUE INDEX "bank_response_imports_batch_filehash_unique"
  ON "bank_response_imports" ("payout_batch_id", "file_hash")
  WHERE "file_hash" IS NOT NULL;
