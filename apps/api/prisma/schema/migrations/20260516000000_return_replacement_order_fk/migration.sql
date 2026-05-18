-- Phase 5 follow-up (2026-05-16) — Return.replacement_order_id +
-- exchange_order_id promoted from loose string pointers to real
-- foreign keys onto master_orders(id).
--
-- onDelete: SetNull preserves the Return row when a replacement /
-- exchange order is admin-deleted (rare; usually the return travels
-- through the standard close path). Cascade would silently destroy
-- compliance-relevant return audit trail.
--
-- Pre-check: confirm no current rows reference a non-existent master
-- order. The query below is non-destructive — if it returns any
-- rows, finance ops must clean them up BEFORE this migration runs.
--
--   SELECT r.id, r.replacement_order_id, r.exchange_order_id
--     FROM returns r
--    WHERE (r.replacement_order_id IS NOT NULL
--           AND NOT EXISTS (SELECT 1 FROM master_orders mo
--                            WHERE mo.id = r.replacement_order_id))
--       OR (r.exchange_order_id IS NOT NULL
--           AND NOT EXISTS (SELECT 1 FROM master_orders mo
--                            WHERE mo.id = r.exchange_order_id));
--
-- If clean: run the constraint adds below. Both are SetNull so
-- post-migration deletes of replacement orders won't cascade-delete
-- the originating return.

ALTER TABLE "returns"
  ADD CONSTRAINT "returns_replacement_order_id_fkey"
  FOREIGN KEY ("replacement_order_id")
  REFERENCES "master_orders"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "returns"
  ADD CONSTRAINT "returns_exchange_order_id_fkey"
  FOREIGN KEY ("exchange_order_id")
  REFERENCES "master_orders"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Indexes for the new FK columns. Postgres does NOT auto-create them
-- on FK constraints; without these indexes the SetNull cascade scans
-- the whole returns table on every master_orders delete.

CREATE INDEX IF NOT EXISTS "returns_replacement_order_id_idx"
  ON "returns"("replacement_order_id");

CREATE INDEX IF NOT EXISTS "returns_exchange_order_id_idx"
  ON "returns"("exchange_order_id");
