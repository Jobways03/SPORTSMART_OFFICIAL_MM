-- Phase 160 (§52 TCS lifecycle audit remediation).
--
-- Closes the schema gaps for the final §52 lifecycle stage + the audit
-- / history hardening the audit called out:
--
--   B1 / #12  TCS certificate columns. GST §52(5) requires the operator
--             to furnish a certificate to each supplier. The lifecycle
--             previously stopped at PAID_TO_GOVT. (certificate_number,
--             certificate_issued_at, certificate_issued_by, plus the
--             storage_key / url reserved for the stored-PDF pipeline.)
--
--   #11       payment_proof_file_id — optional bank-challan PDF handle so
--             a CBIC audit can pull the challan, not just the reference.
--
--   #9 / #10  compute_warnings_json — non-fatal compute warnings (multi-
--             GSTIN spread, rate variance) surfaced to the CA without
--             blocking the row.
--
--   #8        reversed_at / reversed_by / reversal_reason — structured
--             reversal metadata so the reason no longer overloads (and
--             truncates at 500 chars) computed_reason.
--
--   #6 / #8   gst_tcs_ledger_event — append-only lifecycle history. One
--             immutable row per transition (mirrors the franchise
--             inventory ledger-immutability convention).

-- 1. Certificate stage columns.
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "certificate_number" TEXT,
  ADD COLUMN "certificate_issued_at" TIMESTAMP(3),
  ADD COLUMN "certificate_issued_by" TEXT,
  ADD COLUMN "certificate_storage_key" TEXT,
  ADD COLUMN "certificate_url" TEXT;

-- 2. Proof-of-payment file handle (audit #11).
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "payment_proof_file_id" TEXT;

-- 3. Non-fatal compute warnings (audit #9 / #10).
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "compute_warnings_json" JSONB NOT NULL DEFAULT '[]'::JSONB;

-- 4. Structured reversal metadata (audit #8).
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by" TEXT,
  ADD COLUMN "reversal_reason" TEXT;

-- 5. A certificate number is globally unique once issued. Partial unique
--    index (only non-null values) so unissued rows don't collide on NULL.
CREATE UNIQUE INDEX "gst_tcs_settlement_ledger_certificate_number_key"
  ON "gst_tcs_settlement_ledger" ("certificate_number")
  WHERE "certificate_number" IS NOT NULL;

-- 6. Append-only lifecycle event log (audit #6 / #8).
--    The TcsLedgerEventType enum is NEW (no prior value to extend), so
--    CREATE TYPE is safe inside this migration's transaction — unlike
--    ALTER TYPE ... ADD VALUE (handled in the 000000 migration), CREATE
--    TYPE has no in-transaction restriction in PostgreSQL.
CREATE TYPE "TcsLedgerEventType" AS ENUM (
  'COMPUTED',
  'COLLECTED',
  'FILED',
  'PAID_TO_GOVT',
  'CERTIFICATE_ISSUED',
  'REVERSED'
);

CREATE TABLE "gst_tcs_ledger_event" (
  "id"            TEXT NOT NULL,
  "ledger_id"     TEXT NOT NULL,
  "event_type"    "TcsLedgerEventType" NOT NULL,
  "from_status"   "TcsStatus",
  "to_status"     "TcsStatus" NOT NULL,
  "actor_id"      TEXT,
  "reason"        TEXT,
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gst_tcs_ledger_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gst_tcs_ledger_event_ledger_id_created_at_idx"
  ON "gst_tcs_ledger_event" ("ledger_id", "created_at");
CREATE INDEX "gst_tcs_ledger_event_event_type_idx"
  ON "gst_tcs_ledger_event" ("event_type");

ALTER TABLE "gst_tcs_ledger_event"
  ADD CONSTRAINT "gst_tcs_ledger_event_ledger_id_fkey"
  FOREIGN KEY ("ledger_id") REFERENCES "gst_tcs_settlement_ledger" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
