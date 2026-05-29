-- Phase 112 — speed up admin-only dispute-thread filters
-- (e.g. "list internal notes on this dispute"). The existing
-- (dispute_id, created_at) index doesn't help when filtering on is_internal_note.
CREATE INDEX "dispute_messages_dispute_id_is_internal_note_created_at_idx"
  ON "dispute_messages"("dispute_id", "is_internal_note", "created_at");
