-- Phase 172 (Goodwill Credit audit #9) — goodwill expiry ENFORCEMENT.
--
-- `lapsed_at` marks a GOODWILL wallet-transaction lot once the expiry sweep has
-- processed it. The sweep's candidate query filters on it so already-handled
-- lots aren't re-scanned (no starvation under a batch limit). It does NOT
-- participate in balance math — getSpendableBalance / the sweep replay the
-- ledger (computeGoodwillState), this column is purely a processing marker.

ALTER TABLE "wallet_transactions"
  ADD COLUMN IF NOT EXISTS "lapsed_at" TIMESTAMP(3);

-- Partial index: the sweep looks up expired, not-yet-lapsed goodwill lots.
CREATE INDEX IF NOT EXISTS "wallet_transactions_goodwill_unlapsed_idx"
  ON "wallet_transactions" ("credit_type", "expires_at")
  WHERE "credit_type" = 'GOODWILL' AND "lapsed_at" IS NULL;
