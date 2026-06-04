-- Phase 193 — Product Detail Page audit remediation.
--
-- #16 composite index for the PDP/related/facet stock predicate.
-- #15 BackInStockRequest ("notify me when back in stock").

CREATE INDEX IF NOT EXISTS "seller_product_mappings_product_id_is_active_approval_status_idx"
  ON "seller_product_mappings" ("product_id", "is_active", "approval_status");

CREATE TABLE IF NOT EXISTS "back_in_stock_requests" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "customer_id" TEXT,
  "notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "back_in_stock_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "back_in_stock_requests_product_id_email_key"
  ON "back_in_stock_requests" ("product_id", "email");
CREATE INDEX IF NOT EXISTS "back_in_stock_requests_product_id_notified_at_idx"
  ON "back_in_stock_requests" ("product_id", "notified_at");

ALTER TABLE "back_in_stock_requests"
  ADD CONSTRAINT "back_in_stock_requests_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
