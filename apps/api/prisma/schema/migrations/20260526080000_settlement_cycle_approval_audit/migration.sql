-- Phase 144 — settlement cycle approval audit columns. Approving a cycle commits
-- sellers' payouts (and triggers TCS/TDS); the who/when/why must be answerable
-- from the schema, not just the shared cycle.updated_at.
ALTER TABLE "settlement_cycles" ADD COLUMN "approved_by_admin_id" TEXT;
ALTER TABLE "settlement_cycles" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "settlement_cycles" ADD COLUMN "approval_notes" TEXT;

ALTER TABLE "settlement_cycles"
  ADD CONSTRAINT "settlement_cycles_approved_by_admin_id_fkey"
  FOREIGN KEY ("approved_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
