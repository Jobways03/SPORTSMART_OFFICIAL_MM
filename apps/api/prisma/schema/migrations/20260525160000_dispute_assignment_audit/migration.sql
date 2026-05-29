-- Phase 111 — dispute assignment audit columns + reviewer-queue index.
-- assignedAdminId already exists; these add WHEN and BY WHOM the current
-- assignment was made (both NULL when unassigned). The full change chain
-- lives in audit_logs (action=dispute.assigned).
ALTER TABLE "disputes" ADD COLUMN "assigned_at" TIMESTAMP(3);
ALTER TABLE "disputes" ADD COLUMN "assigned_by_admin_id" TEXT;

-- Drives the admin "disputes assigned to reviewer X" queue filter
-- (admin-disputes list endpoint filters on assignedAdminId).
CREATE INDEX "disputes_assigned_admin_id_status_idx" ON "disputes"("assigned_admin_id", "status");
