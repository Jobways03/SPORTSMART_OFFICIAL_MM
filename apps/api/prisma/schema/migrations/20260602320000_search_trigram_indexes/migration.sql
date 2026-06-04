-- Phase 195 (#8) — trigram GIN indexes for storefront search.
--
-- Every public search runs `ILIKE '%term%'` on products.title /
-- short_description / product_code (catalog path) and on brands.name /
-- categories.name (search-module facade). A leading-wildcard ILIKE can't use
-- a B-tree, so each search was a full sequential scan. pg_trgm + GIN turns
-- those into index scans.
--
-- gin_trgm_ops also accelerates the escaped-literal patterns introduced in
-- this phase (#9), since the planner extracts trigrams from the constant.
--
-- CREATE INDEX CONCURRENTLY is NOT used here because Prisma wraps each
-- migration in a transaction (CONCURRENTLY is disallowed inside one). On the
-- current catalog size the plain build is sub-second; for a very large
-- catalog run an out-of-band CONCURRENTLY build instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_title_trgm_idx"
  ON "products" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_short_description_trgm_idx"
  ON "products" USING gin ("short_description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_product_code_trgm_idx"
  ON "products" USING gin ("product_code" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "brands_name_trgm_idx"
  ON "brands" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "categories_name_trgm_idx"
  ON "categories" USING gin ("name" gin_trgm_ops);
