-- AlterTable
ALTER TABLE "audit_logs"
  ADD COLUMN "prev_hash" TEXT,
  ADD COLUMN "hash" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_resource_resource_id_idx" ON "audit_logs"("resource", "resource_id");
