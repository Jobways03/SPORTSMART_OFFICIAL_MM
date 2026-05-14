-- Sprint 3 Story 2.3 — save-for-later cart depth.
--
-- Adds `saved_for_later` boolean on cart_items. Active vs saved items
-- share the same (cart, product, variant) unique slot — an item is in
-- exactly one state at a time. The application's addItem path flips
-- this back to FALSE on re-add, so a saved item snaps back into the
-- active cart when the user re-adds it (matches typical e-commerce UX).
--
-- DEFAULT FALSE so every existing cart item stays active. No backfill
-- needed beyond the column default.

ALTER TABLE "cart_items"
  ADD COLUMN "saved_for_later" BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the "saved items" list query. Active items are
-- the hot path; the saved list is rarely queried but should still
-- be fast when it is. Postgres will only include rows with the flag
-- set, keeping the index tiny.
CREATE INDEX "cart_items_cart_id_saved_for_later_idx"
  ON "cart_items"("cart_id")
  WHERE "saved_for_later" = TRUE;
