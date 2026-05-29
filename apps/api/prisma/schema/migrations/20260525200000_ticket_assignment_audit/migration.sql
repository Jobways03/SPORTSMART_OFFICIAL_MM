-- Phase 118 — ticket assignment audit columns. assignedAdminId already exists;
-- these add WHEN and BY WHOM the current assignment was made (both NULL when
-- unassigned). The full who→whom chain lives in audit_logs (action=ticket.assigned).
ALTER TABLE "tickets" ADD COLUMN "assigned_at" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "assigned_by_admin_id" TEXT;
