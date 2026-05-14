-- Phase 19 GST — PDF render retry tracking on tax_documents.
--
-- The PDF retry cron picks up rows in status PDF_PENDING + status
-- PDF_FAILED (with retry_count below the cap) and re-attempts render
-- + upload. Each pass increments retry_count and stamps last_attempted_at;
-- the failure reason is preserved for ops triage. After the retry cap,
-- the row stays in PDF_FAILED + AdminTask `TAX_DOCUMENT_PDF_FAILED`
-- opens (NEW AdminTaskKind below) so finance/ops can intervene.

ALTER TABLE "tax_documents"
  ADD COLUMN IF NOT EXISTS "pdf_retry_count"       INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pdf_last_attempted_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "pdf_failure_reason"    TEXT,
  -- Stores the stub provider key (e.g. local filesystem path) OR the
  -- real signed URL once we wire S3. Distinct from `pdf_storage_path`
  -- (which is the provider-specific object key); `pdf_provider` records
  -- which adapter wrote the row.
  ADD COLUMN IF NOT EXISTS "pdf_provider"          TEXT;

-- New AdminTaskKind for the post-retry-cap escalation.
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'TAX_DOCUMENT_PDF_FAILED';

-- Partial index drives the retry cron: status IN (PDF_PENDING,
-- PDF_FAILED) AND retry_count < N AND last_attempted_at < (now - cooldown).
-- We index status alone; the cron applies the rest of the predicate.
CREATE INDEX IF NOT EXISTS "tax_documents_pdf_retry_idx"
  ON "tax_documents" ("status", "pdf_retry_count", "pdf_last_attempted_at")
  WHERE "status" IN ('PDF_PENDING', 'PDF_FAILED');
