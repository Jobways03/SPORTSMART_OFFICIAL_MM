-- Phase 13 — dedicated AdminTaskKind values for return-side ops.
-- The earlier batches enqueued return-related tasks under `OTHER`
-- with descriptive reason text; this migration adds explicit kinds
-- so the admin queue can filter / route them per surface (refund
-- failures go to finance ops; liability-ledger backfills go to
-- platform/finance review).
--
-- Additive — existing rows keep their values; the placeholder
-- callers in ReturnService are updated in the same PR.

ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'RETURN_REFUND_FAILED';
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'RETURN_LIABILITY_LEDGER_BACKFILL';
