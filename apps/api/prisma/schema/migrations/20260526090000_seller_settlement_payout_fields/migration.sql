-- Phase 145 — per-settlement mark-paid hardening: payout provenance + payment
-- metadata + failure reason, and a unique guard on the bank UTR.

ALTER TABLE "seller_settlements" ADD COLUMN "paid_by_admin_id" TEXT;
ALTER TABLE "seller_settlements" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "seller_settlements" ADD COLUMN "payment_proof_url" TEXT;
ALTER TABLE "seller_settlements" ADD COLUMN "payment_failure_reason" TEXT;

ALTER TABLE "seller_settlements"
  ADD CONSTRAINT "seller_settlements_paid_by_admin_id_fkey"
  FOREIGN KEY ("paid_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- UTR is a globally-unique bank reference. A unique index rejects a duplicate
-- (copy-paste error masking a real payment failure). Postgres treats NULLs as
-- distinct, so unpaid settlements (utr_reference IS NULL) all coexist.
CREATE UNIQUE INDEX "seller_settlement_utr_unique"
  ON "seller_settlements"("utr_reference");
