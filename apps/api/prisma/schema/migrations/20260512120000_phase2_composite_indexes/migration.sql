-- Phase 2 (PR 2.1) — composite indexes for hot query paths.
--
-- Each index targets a query pattern the application actually issues
-- with high frequency; the existing single-column indexes either don't
-- match the WHERE clause cleanly or force a sort step over the result.
--
-- These are pure additions — they never block writes, can be created
-- without locking the table (a transactional CREATE INDEX is fast on
-- non-massive tables; for terabyte-scale tables prod ops should add
-- CONCURRENTLY by hand at deploy time, but Prisma's migration runner
-- can't wrap CONCURRENTLY in a transaction so we keep this file
-- transactional).
--
-- Index name convention: <table>_<col1>_<col2>_..._idx, matching the
-- existing Prisma-generated naming. The DESC sort modifier doesn't
-- appear in the SQL name (Prisma adds direction to the column list,
-- not the name).

-- master_orders ─────────────────────────────────────────────────────

-- Customer order history page: WHERE customer_id = ? ORDER BY created_at DESC.
-- Pre-PR: leading customer_id index narrows but Postgres still sorts
-- every order for that customer. Composite returns results in index
-- order so LIMIT 20 reads exactly 20 rows.
CREATE INDEX "master_orders_customer_id_created_at_idx"
  ON "master_orders" ("customer_id", "created_at" DESC);

-- Payment-expiry sweep crons: WHERE order_status = 'PENDING_PAYMENT'
-- AND payment_expires_at < NOW(). Today the cron walks every
-- PENDING_PAYMENT row even when most haven't expired yet.
CREATE INDEX "master_orders_order_status_payment_expires_at_idx"
  ON "master_orders" ("order_status", "payment_expires_at");

-- sub_orders ────────────────────────────────────────────────────────

-- Acceptance-timeout sweeper (runs every 5 min):
--   WHERE accept_status = 'OPEN' AND accept_deadline_at < NOW().
-- Without this, the sweeper does a full scan over OPEN sub-orders;
-- with N marketplace activity that's an unbounded-growth scan.
CREATE INDEX "sub_orders_accept_status_accept_deadline_at_idx"
  ON "sub_orders" ("accept_status", "accept_deadline_at");

-- Seller dashboard "my orders by status":
--   WHERE seller_id = ? AND accept_status = ? ORDER BY created_at DESC.
-- The pre-PR (seller_id) index alone forces a sort over every order
-- for that seller. The three-column composite serves both filter
-- and ORDER BY from the index.
CREATE INDEX "sub_orders_seller_id_accept_status_created_at_idx"
  ON "sub_orders" ("seller_id", "accept_status", "created_at" DESC);

-- Franchise equivalent of the seller dashboard query
-- (franchise-orders.service.ts uses the same shape).
CREATE INDEX "sub_orders_franchise_id_accept_status_created_at_idx"
  ON "sub_orders" ("franchise_id", "accept_status", "created_at" DESC);

-- returns ───────────────────────────────────────────────────────────

-- Admin returns queue: WHERE status = ? ORDER BY created_at DESC.
-- Same shape as the customer order-history fix above — index order
-- saves a sort step on every page.
CREATE INDEX "returns_status_created_at_idx"
  ON "returns" ("status", "created_at" DESC);
