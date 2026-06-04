-- Phase 183 (Wallet Credit/Debit audit) — audit-grade reason + distinct manual
-- adjustment types.

ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'MANUAL_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'MANUAL_DEBIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'GOODWILL_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'ORDER_REDEMPTION';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'REVERSAL';

-- #2 — audit-grade reason (distinct from customer-facing description).
ALTER TABLE "wallet_transactions" ADD COLUMN "reason" TEXT;
