-- Phase 107 (2026-05-25) — index for the returns CSV export.
--
-- A date-only export (no status filter) ordered by created_at DESC could not
-- use the existing [status, created_at] composite (status is the leading
-- column), forcing a sequential scan + sort. This single-column DESC index
-- serves the bare range scan and the export's keyset cursor
-- (ORDER BY created_at DESC, id DESC).

CREATE INDEX "returns_created_at_idx" ON "returns"("created_at" DESC);
