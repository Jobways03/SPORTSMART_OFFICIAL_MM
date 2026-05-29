-- Phase 146 — payout provenance on franchise settlements (mirrors the seller
-- side), so a batch franchise payout records who marked it paid.
ALTER TABLE "franchise_settlements" ADD COLUMN "paid_by_admin_id" TEXT;

ALTER TABLE "franchise_settlements"
  ADD CONSTRAINT "franchise_settlements_paid_by_admin_id_fkey"
  FOREIGN KEY ("paid_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
