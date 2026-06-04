-- Phase 160 (E-Invoicing IRN flow audit remediation).
--
--   schema gap (generatedBy/generatedAt) — who/when the IRN was minted,
--     distinct from ackDate (NIC ack) and einvoice_last_attempted_at.
--   #8  einvoice_error_code — the NIC business error code split out from
--     the free-text reason so admin queries filter by code.
--   #7  Mutation-after-IRN guard — a DB trigger that REJECTS any UPDATE
--     to the money columns once an IRN has been minted (einvoice_status =
--     'GENERATED'). The IRN is a cryptographic signature over the
--     invoice values; mutating them after minting silently breaks the
--     signature. Enforced at the DB so NO code path (service, script,
--     manual SQL via the app role) can bypass it. The cancel path sets
--     status away from GENERATED first, so legitimate corrections (cancel
--     → credit/debit note) are unaffected.

-- 1. Actor + mint-time + error-code columns.
ALTER TABLE "tax_documents"
  ADD COLUMN "einvoice_error_code"   TEXT,
  ADD COLUMN "einvoice_generated_by" TEXT,
  ADD COLUMN "einvoice_generated_at" TIMESTAMP(3);

-- 2. Mutation-after-IRN guard. Rejects an UPDATE that changes any tax
--    money column while the row's PRE-image is GENERATED. Comparing the
--    OLD (pre-update) status means a cancel (which moves the row to
--    CANCELLED in the same statement) still trips the guard if it also
--    tried to change amounts — but cancel never touches amounts, so it
--    passes. A credit/debit note is a SEPARATE row, never an UPDATE of
--    the original, so it's unaffected.
CREATE OR REPLACE FUNCTION "tax_documents_block_mutation_after_irn"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."einvoice_status" = 'GENERATED' AND (
       NEW."taxable_amount_in_paise"  IS DISTINCT FROM OLD."taxable_amount_in_paise"
    OR NEW."cgst_amount_in_paise"     IS DISTINCT FROM OLD."cgst_amount_in_paise"
    OR NEW."sgst_amount_in_paise"     IS DISTINCT FROM OLD."sgst_amount_in_paise"
    OR NEW."igst_amount_in_paise"     IS DISTINCT FROM OLD."igst_amount_in_paise"
    OR NEW."cess_amount_in_paise"     IS DISTINCT FROM OLD."cess_amount_in_paise"
    OR NEW."document_total_in_paise"  IS DISTINCT FROM OLD."document_total_in_paise"
  ) THEN
    RAISE EXCEPTION 'tax_document % has a generated IRN; its tax amounts are immutable. Cancel the IRN (within 24h) or issue a credit/debit note instead.', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_tax_documents_block_mutation_after_irn" ON "tax_documents";
CREATE TRIGGER "trg_tax_documents_block_mutation_after_irn"
  BEFORE UPDATE ON "tax_documents"
  FOR EACH ROW
  EXECUTE FUNCTION "tax_documents_block_mutation_after_irn"();
