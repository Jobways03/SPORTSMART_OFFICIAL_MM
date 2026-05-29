-- Phase 140 — composite index for the common commission export/list filter combo
-- (a seller's records over a date range). Serves it with one index scan instead
-- of two single-column scans + a merge.
CREATE INDEX "commission_records_seller_id_created_at_idx"
  ON "commission_records"("seller_id", "created_at");
