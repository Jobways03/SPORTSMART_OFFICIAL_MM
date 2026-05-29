-- Phase 159s (2026-05-27) — Daily POS Report audit. Index for the
-- status-filtered day-range queries (void/return counts grouped by status).
CREATE INDEX IF NOT EXISTS "franchise_pos_sales_franchise_id_status_sold_at_idx"
  ON "franchise_pos_sales" ("franchise_id", "status", "sold_at");
