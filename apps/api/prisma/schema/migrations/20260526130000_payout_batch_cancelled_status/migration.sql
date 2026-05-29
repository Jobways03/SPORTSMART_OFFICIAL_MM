-- Phase 151 (2026-05-26) — Payout Batch Creation audit.
-- CANCELLED batch status (abort a batch created in error before payment).
-- Isolated: PostgreSQL forbids using a newly-added enum value in the same
-- transaction that adds it, and the next migration's partial index references
-- 'CANCELLED', so this must commit first.
ALTER TYPE "PayoutBatchStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
