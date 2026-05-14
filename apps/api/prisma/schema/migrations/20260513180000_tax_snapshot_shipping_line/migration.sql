-- Phase 7 of the GST/tax/invoice system — shipping as a tax line.
--
-- 1. Relax order_item_tax_snapshots.order_item_id to nullable. Existing
--    PRODUCT rows continue to have a non-null orderItemId; new SHIPPING
--    / GIFT_WRAP / etc. rows can have orderItemId = NULL.
--
-- 2. The existing UNIQUE on order_item_id still enforces "one PRODUCT
--    snapshot per orderItem" — PostgreSQL's default NULLS DISTINCT
--    treats multiple NULLs as non-conflicting, so non-PRODUCT rows
--    do not collide via this index.
--
-- 3. Add a partial UNIQUE on (sub_order_id, line_type) WHERE
--    line_type != 'PRODUCT' so each sub-order can have at most one
--    SHIPPING / GIFT_WRAP / CONVENIENCE_FEE / COD_FEE / ROUND_OFF
--    snapshot row.
--
-- See docs/tax/CA.md §A Phase 7 log.

ALTER TABLE "order_item_tax_snapshots"
  ALTER COLUMN "order_item_id" DROP NOT NULL;

-- The FK was created with ON DELETE CASCADE. Keep that — deleting an
-- OrderItem (rare; should never happen for an audited tax record)
-- still cascades the row. Switching to SET NULL would leave orphan
-- tax rows that no longer belong to any line.

-- Partial UNIQUE for non-PRODUCT lines. PostgreSQL-specific syntax;
-- Prisma's schema can't express partial UNIQUE so this lives only
-- in the migration. The application uses `findFirst` (not
-- `findUnique`) when looking up these rows.
CREATE UNIQUE INDEX "order_item_tax_snapshots_non_product_uniq"
  ON "order_item_tax_snapshots"("sub_order_id", "line_type")
  WHERE "line_type" != 'PRODUCT';
