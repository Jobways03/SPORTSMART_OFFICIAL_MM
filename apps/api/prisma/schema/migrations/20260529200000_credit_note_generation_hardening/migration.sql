-- Phase 164 — Credit Note Generation flow audit remediation.
--
-- #2  return_id: first-class structured linkage from a CREDIT_NOTE to its
--     originating Return (replaces the brittle `reason CONTAINS returnNumber`
--     join used for idempotency, which an admin reason override defeated).
-- #14 partial_coverage_line_count: how many QC-approved lines were skipped
--     because their OrderItemTaxSnapshot was missing (legacy orders). 0 = full.
-- #20 customer_notified_at: set when the CN-issued customer notification fired.
-- #7  indexes backing the prior-CN lookup + the "CNs for this return" query.
--
-- NOTE on #1 (duplicate-CN race): we deliberately DO NOT add a
-- UNIQUE(original_document_id, return_id) constraint. The multi-cycle
-- staged-QC design issues MULTIPLE legitimate credit notes per return (a
-- day-1 delta CN, a day-5 delta CN, ...), so that pair is intentionally
-- non-unique — a unique constraint would break a correct flow. The race is
-- closed instead by a per-return transaction-scoped advisory lock in
-- CreditNoteService (pg_advisory_xact_lock), which serialises concurrent
-- generation so the second caller sees the first caller's CN and computes a
-- zero delta (idempotent no-op). The advisory lock is a strictly stronger
-- guarantee than a unique constraint for preventing the read-compute-write race.

ALTER TABLE "tax_documents"
  ADD COLUMN IF NOT EXISTS "return_id" TEXT,
  ADD COLUMN IF NOT EXISTS "partial_coverage_line_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customer_notified_at" TIMESTAMP(3);

-- #7 — prior-CN lookup + cumulative-reversal scan filter by (origin [, status]).
CREATE INDEX IF NOT EXISTS "tax_documents_original_doc_status_idx"
  ON "tax_documents" ("original_document_id", "status");

-- #1/#2 — "the credit note(s) for this return" without a text scan.
CREATE INDEX IF NOT EXISTS "tax_documents_return_id_idx"
  ON "tax_documents" ("return_id");

-- Best-effort backfill of return_id for existing credit notes whose reason
-- still carries the return number (the pre-#3 default reason "Return RTN-XXXX").
-- Admin-override CNs with a custom reason that dropped the return number cannot
-- be recovered here (that is exactly the #3 gap) — the structural write-time
-- population fixes it going forward. Multiple CNs for one return all resolve to
-- the same return_id (correct: the multi-cycle design).
UPDATE "tax_documents" td
SET "return_id" = r."id"
FROM "returns" r
WHERE td."document_type" = 'CREDIT_NOTE'
  AND td."return_id" IS NULL
  AND td."reason" IS NOT NULL
  AND td."reason" LIKE '%' || r."return_number" || '%';
