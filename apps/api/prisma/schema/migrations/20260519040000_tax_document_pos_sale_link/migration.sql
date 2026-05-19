-- Follow-up #133 (2026-05-19) — POS sale → tax_documents linkage.
--
-- Pre-existing tax_documents always carried a non-null customer_id and
-- linked to e-commerce orders via sub_order_id / master_order_id. POS
-- sales have walk-in customers (no User row) and need their own
-- foreign key. This migration:
--
--   1. Relaxes customer_id to nullable (POS rows leave it NULL; the
--      e-commerce path keeps populating it).
--   2. Adds pos_sale_id pointing to franchise_pos_sales, mutually
--      exclusive with sub_order_id (enforced at service layer, not in
--      the DB — both are nullable and the generator picks one path).
--   3. Indexes pos_sale_id so reverse-lookup from a sale to its
--      invoice is bounded.
--
-- Rollback: ALTER COLUMN customer_id back to NOT NULL (only after
-- backfilling NULLs — for early-stage POS this should be a no-op or
-- small set), DROP COLUMN pos_sale_id, DROP INDEX.

ALTER TABLE "tax_documents"
    ALTER COLUMN "customer_id" DROP NOT NULL;

ALTER TABLE "tax_documents"
    ADD COLUMN "pos_sale_id" TEXT;

CREATE INDEX "tax_documents_pos_sale_id_idx"
    ON "tax_documents" ("pos_sale_id");
