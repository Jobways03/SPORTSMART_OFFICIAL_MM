-- Phase 119 — ticket priority audit columns + priority-first queue index.
ALTER TABLE "tickets" ADD COLUMN "priority_updated_by" TEXT;
ALTER TABLE "tickets" ADD COLUMN "priority_updated_at" TIMESTAMP(3);

-- Admin queue sorts URGENT→LOW then recency; this index keeps that cheap.
CREATE INDEX "tickets_priority_last_message_at_idx"
  ON "tickets"("priority", "last_message_at" DESC);
