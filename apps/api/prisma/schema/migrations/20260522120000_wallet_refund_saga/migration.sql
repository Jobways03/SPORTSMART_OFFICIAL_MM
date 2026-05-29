-- Phase 70 (2026-05-22) — Phase 66 audit Gap #8.
--
-- Minimal saga state for the wallet-refund-on-checkout-cancel flow.
-- Pre-Phase-70 the refund call swallowed errors with no retry;
-- the saga row + cron close that gap without pulling in a full
-- event-bus saga framework.

CREATE TYPE "WalletRefundSagaStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'FAILED',
  'ABANDONED'
);

CREATE TABLE "wallet_refund_sagas" (
  "id"               TEXT PRIMARY KEY,
  "customer_id"      TEXT NOT NULL,
  "order_id"         TEXT NOT NULL,
  "amount_in_paise"  BIGINT NOT NULL,
  "reason"           TEXT NOT NULL,
  "status"           "WalletRefundSagaStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"         INTEGER NOT NULL DEFAULT 0,
  "last_error"       TEXT,
  "last_attempt_at"  TIMESTAMP,
  "completed_at"     TIMESTAMP,
  "created_at"       TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Retry-sweep predicate: status IN (PENDING, FAILED) AND
-- last_attempt_at < cutoff. Composite (status, last_attempt_at)
-- supports that scan without touching COMPLETED rows.
CREATE INDEX "wallet_refund_sagas_status_last_attempt_idx"
  ON "wallet_refund_sagas" ("status", "last_attempt_at");

CREATE INDEX "wallet_refund_sagas_order_id_idx"
  ON "wallet_refund_sagas" ("order_id");

-- One active saga per (orderId, customerId, amountInPaise) so a
-- retried place-order path doesn't queue duplicate refunds.
-- Completed sagas don't participate (allows a future top-up to
-- enqueue a fresh refund if needed).
CREATE UNIQUE INDEX "wallet_refund_sagas_active_dedup"
  ON "wallet_refund_sagas" ("order_id", "customer_id", "amount_in_paise")
  WHERE "status" IN ('PENDING', 'FAILED');
