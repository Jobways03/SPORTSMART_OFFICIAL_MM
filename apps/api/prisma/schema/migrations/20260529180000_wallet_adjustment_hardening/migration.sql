-- Phase 162 (Wallet Adjustments approval flow audit remediation).
--
--   #12  reversal columns — a posted adjustment can be reversed with a
--        compensating inverse ledger entry (status → REVERSED).
--   #11  wallet_adjustment_history — append-only state-transition trail.

ALTER TABLE "wallet_adjustments"
  ADD COLUMN "reversed_by_admin_id"     TEXT,
  ADD COLUMN "reversed_at"              TIMESTAMP(3),
  ADD COLUMN "reverse_reason"           TEXT,
  ADD COLUMN "reversing_transaction_id" TEXT;

CREATE TABLE "wallet_adjustment_history" (
  "id"              TEXT NOT NULL,
  "adjustment_id"   TEXT NOT NULL,
  "customer_id"     TEXT NOT NULL,
  "action"          TEXT NOT NULL,
  "from_status"     "WalletAdjustmentStatus",
  "to_status"       "WalletAdjustmentStatus" NOT NULL,
  "actor_id"        TEXT,
  "reason"          TEXT,
  "amount_in_paise" BIGINT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_adjustment_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "wallet_adjustment_history_adjustment_id_created_at_idx"
  ON "wallet_adjustment_history" ("adjustment_id", "created_at" DESC);
CREATE INDEX "wallet_adjustment_history_customer_id_created_at_idx"
  ON "wallet_adjustment_history" ("customer_id", "created_at" DESC);
