-- AlterTable: dispute → ticket back-link
ALTER TABLE "disputes"
  ADD COLUMN "source_ticket_id" TEXT;

-- AlterTable: ticket → dispute forward-link
ALTER TABLE "tickets"
  ADD COLUMN "promoted_to_dispute_id" TEXT;

-- CreateIndex
CREATE INDEX "disputes_source_ticket_id_idx" ON "disputes"("source_ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_promoted_to_dispute_id_key" ON "tickets"("promoted_to_dispute_id");
