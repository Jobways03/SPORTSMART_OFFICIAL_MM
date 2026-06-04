-- Phase 172 — GOODWILL_CREDIT Finance Approval Flow audit remediation.
--
-- Makes goodwill first-class on the unified RefundInstruction (isGoodwill +
-- customerRemedy snapshot + customer-visible message) and adds a wallet-ledger
-- credit-type discriminator + optional expiry so goodwill (platform expense) is
-- separable from a genuine refund (liability).

-- ── #8/#9: wallet credit-type discriminator + expiry ─────────────────────────
DO $$ BEGIN
  CREATE TYPE "WalletCreditType" AS ENUM (
    'REFUND_ORIGINAL', 'GOODWILL', 'TIME_BARRED', 'PROMO', 'MANUAL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "wallet_transactions"
  ADD COLUMN IF NOT EXISTS "credit_type" "WalletCreditType",
  ADD COLUMN IF NOT EXISTS "expires_at"  TIMESTAMP(3);

-- An expiry sweep scans goodwill rows past their expiry.
CREATE INDEX IF NOT EXISTS "wallet_transactions_credit_type_expires_at_idx"
  ON "wallet_transactions"("credit_type", "expires_at");

-- ── #2/#12: goodwill marker + remedy snapshot + customer message on refund ───
ALTER TABLE "refund_instructions"
  ADD COLUMN IF NOT EXISTS "is_goodwill"              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customer_remedy"          TEXT,
  ADD COLUMN IF NOT EXISTS "customer_visible_message" TEXT;

-- "pending goodwill approvals" queue filter.
CREATE INDEX IF NOT EXISTS "refund_instructions_is_goodwill_status_idx"
  ON "refund_instructions"("is_goodwill", "status");

-- Backfill is_goodwill + customer_remedy for existing dispute-sourced rows whose
-- linked dispute carried a goodwill remedy (best-effort; nullable remedy stays
-- null where the dispute is gone).
UPDATE "refund_instructions" ri
  SET "customer_remedy" = d."customer_remedy",
      "is_goodwill" = (d."customer_remedy" = 'GOODWILL_CREDIT')
  FROM "disputes" d
  WHERE ri."source_type" = 'DISPUTE'
    AND ri."source_id" = d."id"
    AND ri."customer_remedy" IS NULL;
