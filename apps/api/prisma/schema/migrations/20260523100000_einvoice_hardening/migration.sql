-- Phase 90 (2026-05-23) — e-invoice hardening.
--
-- Gap #4   unique IRN (partial — null IRNs coexist)
-- Gap #19  cancel category + reason audit columns
-- Gap #20  einvoice_audit_logs table
-- Gap #22  signed_document_json_retention_until column + index

ALTER TABLE "tax_documents"
  ADD COLUMN "einvoice_cancellation_code"   INTEGER,
  ADD COLUMN "einvoice_cancellation_reason" TEXT,
  ADD COLUMN "einvoice_cancelled_by"        TEXT,
  ADD COLUMN "signed_document_json_retention_until" TIMESTAMP(3);

-- Gap #4 — partial UNIQUE so live IRNs never collide. NULL IRNs
-- coexist (B2C / not-applicable rows).
CREATE UNIQUE INDEX "tax_documents_irn_uniq"
  ON "tax_documents" ("irn")
  WHERE "irn" IS NOT NULL;

CREATE INDEX "tax_documents_irn_idx"
  ON "tax_documents" ("irn");
CREATE INDEX "tax_documents_einvoice_status_last_attempted_at_idx"
  ON "tax_documents" ("einvoice_status", "einvoice_last_attempted_at");
CREATE INDEX "tax_documents_signed_document_json_retention_until_idx"
  ON "tax_documents" ("signed_document_json_retention_until");

-- Gap #20 — append-only audit log.
CREATE TABLE "einvoice_audit_logs" (
  "id"                  TEXT PRIMARY KEY,
  "tax_document_id"     TEXT NOT NULL,
  "action"              TEXT NOT NULL,
  "from_status"         "EInvoiceStatus",
  "to_status"           "EInvoiceStatus",
  "actor_id"            TEXT,
  "actor_role"          TEXT,
  "reason"              TEXT,
  "provider_name"       TEXT,
  "provider_latency_ms" INTEGER,
  "payload_before"      JSONB,
  "payload_after"       JSONB,
  "ip_address"          TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "einvoice_audit_logs_tax_document_id_fkey"
    FOREIGN KEY ("tax_document_id") REFERENCES "tax_documents"("id")
    ON DELETE RESTRICT
);

CREATE INDEX "einvoice_audit_logs_tax_document_id_created_at_idx"
  ON "einvoice_audit_logs" ("tax_document_id", "created_at" DESC);
CREATE INDEX "einvoice_audit_logs_action_created_at_idx"
  ON "einvoice_audit_logs" ("action", "created_at");
CREATE INDEX "einvoice_audit_logs_actor_id_created_at_idx"
  ON "einvoice_audit_logs" ("actor_id", "created_at");
