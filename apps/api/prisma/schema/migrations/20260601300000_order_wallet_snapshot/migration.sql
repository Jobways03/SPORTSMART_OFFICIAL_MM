-- Phase 184 (Wallet@Checkout audit #2/#3) — authoritative wallet-usage snapshot
-- on the order, removing the COD / fully-wallet-paid reverse-lookup ambiguity.

ALTER TABLE "master_orders"
  ADD COLUMN "wallet_amount_used_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "wallet_transaction_id" TEXT;

-- Backfill from the wallet ledger: the checkout debit row(s) for each order.
-- Handles BOTH the legacy lowercase 'order' referenceType AND the new 'ORDER',
-- and BOTH the legacy generic DEBIT and the new ORDER_REDEMPTION type.
WITH wtx AS (
  SELECT "reference_id" AS order_id,
         SUM(abs("amount_in_paise"))::bigint AS wallet_paise,
         (array_agg("id" ORDER BY "created_at" DESC))[1] AS tx_id
  FROM "wallet_transactions"
  WHERE "reference_type" IN ('order', 'ORDER')
    AND "type" IN ('DEBIT', 'ORDER_REDEMPTION')
    AND "status" = 'COMPLETED'
    AND "reference_id" IS NOT NULL
  GROUP BY "reference_id"
)
UPDATE "master_orders" mo
SET "wallet_amount_used_in_paise" = wtx.wallet_paise,
    "wallet_transaction_id" = wtx.tx_id
FROM wtx WHERE wtx.order_id = mo."id";

CREATE INDEX "master_orders_wallet_transaction_id_idx" ON "master_orders"("wallet_transaction_id");
