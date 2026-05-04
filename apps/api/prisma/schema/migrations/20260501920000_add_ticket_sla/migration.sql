-- AlterTable
ALTER TABLE "tickets"
  ADD COLUMN "resolution_summary" TEXT,
  ADD COLUMN "sla_target_at" TIMESTAMP(3),
  ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalated_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tickets_sla_target_at_status_idx"
  ON "tickets"("sla_target_at", "status")
  WHERE "sla_target_at" IS NOT NULL;
