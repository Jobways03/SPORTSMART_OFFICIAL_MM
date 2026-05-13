-- Phase 2 (PR 2.4) — DB-level CHECK constraints on stock invariants.
--
-- Three invariants the application already enforces (see
-- PR 1.10's CSV stock-import floor + seller-allocation reservation
-- guard); this migration mirrors them at the storage layer so that:
--
--   1. A raw-SQL hotfix run by an admin (e.g. `UPDATE
--      seller_product_mappings SET stock_qty = -10 WHERE ...`) is
--      blocked at the database — the typed-service guards don't help
--      when someone bypasses the service.
--   2. A future direct-write code path (a one-off script, a new
--      module, a different ORM) is forced to keep the same invariants
--      without needing to know about PR 1.10.
--
-- Invariants:
--   stock_qty    >= 0
--   reserved_qty >= 0
--   reserved_qty <= stock_qty   ← oversold-floor: available stays ≥ 0
--
-- The last one is the real load-bearer. Without it, a concurrent
-- decrement of stock_qty (legacy code path) combined with an
-- in-flight reservation could leave `available = stock_qty -
-- reserved_qty < 0`. The seller's catalog says "in stock" but
-- there's literally nothing left to ship.
--
-- NOT VALID is used so the constraint takes effect for new writes
-- immediately without scanning the existing rows (which may contain
-- pre-PR data that violates). Operators can run, during a quiet
-- window:
--
--   ALTER TABLE seller_product_mappings
--     VALIDATE CONSTRAINT seller_product_mappings_stock_qty_non_negative;
--   ALTER TABLE seller_product_mappings
--     VALIDATE CONSTRAINT seller_product_mappings_reserved_qty_non_negative;
--   ALTER TABLE seller_product_mappings
--     VALIDATE CONSTRAINT seller_product_mappings_reserved_lte_stock;
--
-- to upgrade NOT VALID → VALID after auditing any legacy rows. The
-- VALIDATE step is a one-time full-table scan with a SHARE-UPDATE-
-- EXCLUSIVE lock (it does NOT block reads or writes), so it's safe
-- to run online.

ALTER TABLE "seller_product_mappings"
  ADD CONSTRAINT "seller_product_mappings_stock_qty_non_negative"
  CHECK ("stock_qty" >= 0)
  NOT VALID;

ALTER TABLE "seller_product_mappings"
  ADD CONSTRAINT "seller_product_mappings_reserved_qty_non_negative"
  CHECK ("reserved_qty" >= 0)
  NOT VALID;

ALTER TABLE "seller_product_mappings"
  ADD CONSTRAINT "seller_product_mappings_reserved_lte_stock"
  CHECK ("reserved_qty" <= "stock_qty")
  NOT VALID;
