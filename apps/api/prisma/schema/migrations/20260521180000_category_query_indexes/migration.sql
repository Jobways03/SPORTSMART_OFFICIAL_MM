-- Phase 33 (2026-05-21) — query-pattern indexes on categories.
--
-- The admin list page filters by `level`; the storefront tree
-- filters by `isActive` and orders by `(parentId, sortOrder)`. The
-- old schema only had single-column indexes on parentId + slug, so
-- both queries scanned wider than necessary. With ~352 rows today
-- the table-scan cost is invisible; the indexes are forward-looking
-- so the storefront tree assembly stays O(log n) as taxonomy grows.

CREATE INDEX "categories_level_idx" ON "categories" ("level");
CREATE INDEX "categories_is_active_idx" ON "categories" ("is_active");
CREATE INDEX "categories_parent_id_is_active_sort_order_idx"
  ON "categories" ("parent_id", "is_active", "sort_order");
