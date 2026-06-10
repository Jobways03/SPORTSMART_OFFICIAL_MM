-- Phase 250 (Franchise tax) — add a franchise party key to tax_documents so the
-- §52 TCS aggregation can select a franchise's taxable supply directly (mirror
-- of seller_id), instead of joining through sub_orders / pos_sales. Scalar, no
-- FK — exactly like seller_id. Existing FRANCHISE rows are backfilled from their
-- linked sub_order (online) or pos_sale (POS).
--
-- Hand-authored (the dev DB has pre-existing drift vs the migration history, so
-- `migrate dev` can't be used; this file is Phase-250-only and applied via
-- `migrate deploy`).

ALTER TABLE "tax_documents" ADD COLUMN "franchise_id" TEXT;

CREATE INDEX "tax_documents_franchise_id_idx" ON "tax_documents"("franchise_id");

-- Backfill: online (sub_order) franchise invoices.
UPDATE "tax_documents" td
SET "franchise_id" = so."franchise_id"
FROM "sub_orders" so
WHERE td."sub_order_id" = so."id"
  AND td."supplier_type" = 'FRANCHISE'
  AND td."franchise_id" IS NULL
  AND so."franchise_id" IS NOT NULL;

-- Backfill: POS (pos_sale) franchise invoices.
UPDATE "tax_documents" td
SET "franchise_id" = ps."franchise_id"
FROM "franchise_pos_sales" ps
WHERE td."pos_sale_id" = ps."id"
  AND td."supplier_type" = 'FRANCHISE'
  AND td."franchise_id" IS NULL;
