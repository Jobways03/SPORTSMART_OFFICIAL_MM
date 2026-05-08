-- Phase 11 (post-Phase-10) — message mirror provenance.
--
-- When a customer reply on a promoted ticket is mirrored to the linked
-- dispute, OR an admin reply on the dispute is mirrored back to the
-- ticket, we record the source message id on the destination row.
-- Two purposes:
--   (a) Auditability — reconstruct which mirrored row came from which
--       original message; render an indicator in admin UI.
--   (b) Idempotency — UNIQUE constraint guarantees a retried event
--       handler cannot create duplicate mirrored rows when the
--       customer-facing brand voice would otherwise leak doubles.

-- Dispute side: track the originating ticket message
ALTER TABLE "dispute_messages"
  ADD COLUMN "mirrored_from_ticket_message_id" TEXT;

CREATE UNIQUE INDEX "dispute_messages_mirrored_from_ticket_message_id_key"
  ON "dispute_messages"("mirrored_from_ticket_message_id");

-- Ticket side: track the originating dispute message
ALTER TABLE "ticket_messages"
  ADD COLUMN "mirrored_from_dispute_message_id" TEXT;

CREATE UNIQUE INDEX "ticket_messages_mirrored_from_dispute_message_id_key"
  ON "ticket_messages"("mirrored_from_dispute_message_id");
