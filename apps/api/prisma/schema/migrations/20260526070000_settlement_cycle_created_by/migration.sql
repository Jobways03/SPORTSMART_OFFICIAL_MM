-- Phase 141 — settlement cycle creation hardening:
--   createdByAdminId provenance (FK to admins; SET NULL since admins soft-delete)
--   + the [cycle_id, status] composite index the approve/pay sweeps hit.

ALTER TABLE "settlement_cycles" ADD COLUMN "created_by_admin_id" TEXT;

ALTER TABLE "settlement_cycles"
  ADD CONSTRAINT "settlement_cycles_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "seller_settlements_cycle_id_status_idx"
  ON "seller_settlements"("cycle_id", "status");
