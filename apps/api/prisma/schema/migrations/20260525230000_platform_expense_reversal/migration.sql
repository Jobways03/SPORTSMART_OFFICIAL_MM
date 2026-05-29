-- Phase 127 — liability-ledger reversal on refund rejection.
-- PlatformExpense has no status lifecycle (it's a booked cost), so reversal
-- is a soft mark: a non-null reversed_at excludes the row from cost totals.
-- (SellerDebit/LogisticsClaim already reverse via their CANCELLED status.)
ALTER TABLE "platform_expenses" ADD COLUMN "reversed_at" TIMESTAMP(3);
ALTER TABLE "platform_expenses" ADD COLUMN "reversal_reason" TEXT;
