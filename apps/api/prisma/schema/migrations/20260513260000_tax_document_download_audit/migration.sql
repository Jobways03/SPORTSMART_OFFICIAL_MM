-- Phase 20 GST — Tax document download audit.
--
-- One row per signed-URL issuance from the download endpoint. Lets us
-- answer:
--   - "Who downloaded invoice X, when, from what IP?" (forensic).
--   - "Did this seller ever pull an invoice for a sub-order that was
--     reassigned away from them?" (anomaly detection).
--   - "Has this customer pulled the same invoice 50 times in the last
--     hour?" (rate-limit hint — service consults recent counts).
--
-- Distinct from `file_url_audits` because:
--   1. tax_document IDs aren't FileMetadata IDs.
--   2. Tax-document downloads have a richer authorisation context
--      (customer / seller / admin scope) that we want to record
--      verbatim.
--   3. Different retention policy — tax-document audit must outlive
--      the order (Section 36 / 8-year retention), file_url_audits
--      track a more general PII-access window.
--
-- Authorisation outcomes are captured here including DENIED rows so a
-- flooding attempt can still be traced.

DO $$
BEGIN
  CREATE TYPE "TaxDocumentActorType" AS ENUM (
    'CUSTOMER',
    'SELLER',
    'ADMIN',
    'FRANCHISE',
    'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE "TaxDocumentDownloadOutcome" AS ENUM (
    'ALLOWED',
    'DENIED_SCOPE',
    'DENIED_NOT_READY',
    'DENIED_RATE_LIMIT',
    'DENIED_VOIDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS "tax_document_download_audits" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  "tax_document_id" TEXT NOT NULL,

  "actor_type"      "TaxDocumentActorType"       NOT NULL,
  "actor_id"        TEXT NOT NULL,
  "actor_role"      TEXT,

  "outcome"         "TaxDocumentDownloadOutcome" NOT NULL,
  "deny_reason"     TEXT,

  -- The signed URL we issued (when ALLOWED). For audit, not for replay
  -- — the URL itself has its own expiry. Stored for incident response
  -- so "this URL got leaked, what time did we mint it?" is answerable.
  "issued_url"      TEXT,
  "url_expires_at"  TIMESTAMPTZ,
  "ttl_seconds"     INT NOT NULL DEFAULT 300,

  "ip_address"      TEXT,
  "user_agent"      TEXT,

  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "tax_document_download_audits_pkey" PRIMARY KEY ("id")
);

-- Indexes drive: per-document forensic walk + per-actor history +
-- DENIED-only flooding-attack lookup.
CREATE INDEX IF NOT EXISTS "tax_document_download_audits_doc_idx"
  ON "tax_document_download_audits" ("tax_document_id", "created_at");
CREATE INDEX IF NOT EXISTS "tax_document_download_audits_actor_idx"
  ON "tax_document_download_audits" ("actor_type", "actor_id", "created_at");
CREATE INDEX IF NOT EXISTS "tax_document_download_audits_denied_idx"
  ON "tax_document_download_audits" ("outcome", "created_at")
  WHERE "outcome" != 'ALLOWED';

-- FK back to tax_documents. RESTRICT on delete — audit must outlive
-- the document for the statutory retention period.
DO $$
BEGIN
  ALTER TABLE "tax_document_download_audits"
    ADD CONSTRAINT "tax_document_download_audits_tax_document_id_fkey"
    FOREIGN KEY ("tax_document_id") REFERENCES "tax_documents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
