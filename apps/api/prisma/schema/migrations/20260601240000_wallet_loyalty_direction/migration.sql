-- Phase 182 (Customer Wallet audit) — loyalty pillar + statement columns.

-- ── Enum additions (not used within this migration, so safe in the tx) ──
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'LOYALTY_REBATE';
ALTER TYPE "WalletCreditType" ADD VALUE IF NOT EXISTS 'LOYALTY';

CREATE TYPE "WalletDirection" AS ENUM ('CREDIT', 'DEBIT');

-- ── WalletTransaction statement columns (#4/#5/#8/#9) ──
ALTER TABLE "wallet_transactions"
  ADD COLUMN "balance_before_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "direction"               "WalletDirection",
  ADD COLUMN "currency"                TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "reference_number"        TEXT;

-- Backfill: before = after − signed amount; direction from the amount sign.
UPDATE "wallet_transactions"
SET "balance_before_in_paise" = "balance_after_in_paise" - "amount_in_paise",
    "direction" = CASE WHEN "amount_in_paise" >= 0 THEN 'CREDIT'::"WalletDirection" ELSE 'DEBIT'::"WalletDirection" END;

-- audit §8 — "pending topups for this user" + status-filtered history.
CREATE INDEX "wallet_transactions_user_id_status_created_at_idx"
  ON "wallet_transactions"("user_id", "status", "created_at" DESC);

-- ── Loyalty earn ledger (#3) ──
CREATE TYPE "LoyaltyEarnStatus" AS ENUM ('PENDING', 'POSTED', 'SKIPPED');

CREATE TABLE "loyalty_earn_events" (
  "id"                       TEXT NOT NULL,
  "user_id"                  TEXT NOT NULL,
  "source_type"              TEXT NOT NULL,
  "source_id"                TEXT NOT NULL,
  "eligible_amount_in_paise" BIGINT NOT NULL,
  "rebate_in_paise"          BIGINT NOT NULL DEFAULT 0,
  "rate_bps"                 INTEGER NOT NULL DEFAULT 0,
  "status"                   "LoyaltyEarnStatus" NOT NULL DEFAULT 'PENDING',
  "skip_reason"              TEXT,
  "expires_at"               TIMESTAMP(3),
  "wallet_transaction_id"    TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at"                TIMESTAMP(3),
  CONSTRAINT "loyalty_earn_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "loyalty_earn_events_source_type_source_id_key" ON "loyalty_earn_events"("source_type", "source_id");
CREATE INDEX "loyalty_earn_events_user_id_created_at_idx" ON "loyalty_earn_events"("user_id", "created_at");
CREATE INDEX "loyalty_earn_events_status_idx" ON "loyalty_earn_events"("status");
