-- Phase 3 (PR 3.2) — Wallet idempotency UNIQUE.
--
-- Closes the gap documented in §1.12 of the dispute/return trace and
-- in ADR-009: WalletPublicFacade.creditFromRefund accepts an arbitrary
-- referenceId, but nothing at the DB level prevented two writes with
-- the same reference. With this index, the same (referenceType,
-- referenceId, type) tuple cannot appear twice — refund replays are
-- rejected with P2002.
--
-- IMPORTANT — pre-flight on existing data.
-- This CREATE UNIQUE INDEX FAILS if any duplicates already exist. That
-- is the correct behaviour: deploy fails loudly so ops investigates
-- and dedupes BEFORE the constraint locks future writes.
--
-- To check ahead of deploy, run:
--
--   SELECT reference_type, reference_id, type, count(*)
--   FROM wallet_transactions
--   WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL
--   GROUP BY reference_type, reference_id, type
--   HAVING count(*) > 1
--   ORDER BY 4 DESC;
--
-- Each duplicate row needs a finance review: which one is the legit
-- credit/debit, and what compensating entry is required for the other?
-- Document each decision in the wallet's internalNotes column.

CREATE UNIQUE INDEX "wallet_transactions_reference_type_reference_id_type_key"
  ON "wallet_transactions"("reference_type", "reference_id", "type");
