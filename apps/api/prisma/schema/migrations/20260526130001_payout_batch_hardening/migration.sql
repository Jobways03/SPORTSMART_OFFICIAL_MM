-- Phase 151 (2026-05-26) — Payout Batch Creation audit remediation.
--   1. Per-row PayoutStatus enum (PARTIALLY_PAID is a batch rollup, meaningless
--      on a single payout row).
--   2. PayoutBatch denorm: batch_number, file_hash, total_amount_in_paise,
--      settlement_count.
--   3. SellerSettlement.payout_batch_id lock (+ FK + index) — the duplicate-
--      batch guard: a settlement can sit in at most one active batch.
--   4. Global partial unique on payouts(settlement_id) WHERE status NOT IN
--      (FAILED, CANCELLED) — DB-level backstop for the same guard.

-- (1) Row-level payout status enum. Map any legacy PARTIALLY_PAID rows (a
-- batch-only state that never made sense per-row) to FAILED before the cast.
UPDATE "payouts" SET "status" = 'FAILED' WHERE "status" = 'PARTIALLY_PAID';

CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'EXPORTED', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "payouts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payouts"
  ALTER COLUMN "status" TYPE "PayoutStatus" USING ("status"::text::"PayoutStatus");
ALTER TABLE "payouts" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- (2) PayoutBatch denorm columns.
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "batch_number" TEXT;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "file_hash" TEXT;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "total_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "payout_batches" ADD COLUMN IF NOT EXISTS "settlement_count" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "payout_batches_batch_number_key"
  ON "payout_batches" ("batch_number");

-- (3) Settlement payout-batch lock.
ALTER TABLE "seller_settlements" ADD COLUMN IF NOT EXISTS "payout_batch_id" TEXT;
ALTER TABLE "seller_settlements"
  ADD CONSTRAINT "seller_settlements_payout_batch_id_fkey"
  FOREIGN KEY ("payout_batch_id") REFERENCES "payout_batches" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "seller_settlements_payout_batch_id_idx"
  ON "seller_settlements" ("payout_batch_id");

-- (4) One active payout per settlement (across all batches). FAILED / CANCELLED
-- rows are exempt so a settlement can be re-batched after a failed attempt.
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_settlement_active_unique"
  ON "payouts" ("settlement_id")
  WHERE "status" NOT IN ('FAILED', 'CANCELLED');
