-- Shipping options v1 — Shopify-style flat shipping fee + free-shipping
-- threshold. Single-table design (no zones yet) per the v1 scope; zones,
-- weight/price-based rates, and refund policy come later.
--
-- Backward compat: existing orders have shipping_fee_in_paise=0 via the
-- default; existing checkout flow keeps working until an admin creates a
-- shipping option.

DO $$ BEGIN
  CREATE TYPE "ShippingRateType" AS ENUM ('FLAT', 'FREE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "shipping_options" (
  "id"                        TEXT          NOT NULL,
  "name"                      TEXT          NOT NULL,
  "delivery_details"          TEXT,
  "rate_type"                 "ShippingRateType" NOT NULL DEFAULT 'FLAT',
  "price_in_paise"            BIGINT        NOT NULL DEFAULT 0,
  "transit_min_days"          INTEGER,
  "transit_max_days"          INTEGER,
  "free_shipping_min_cart_paise" BIGINT,
  "is_active"                 BOOLEAN       NOT NULL DEFAULT TRUE,
  "sort_order"                INTEGER       NOT NULL DEFAULT 0,
  "created_at"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "shipping_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipping_options_is_active_idx" ON "shipping_options" ("is_active");
CREATE INDEX "shipping_options_sort_order_idx" ON "shipping_options" ("sort_order");

-- Order-level shipping snapshot. We keep both the FK and the name so that
-- deleting/disabling a shipping option later doesn't corrupt historical
-- order records (the name renders the way it looked at order time).
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "shipping_option_id"     TEXT,
  ADD COLUMN IF NOT EXISTS "shipping_option_name"   TEXT,
  ADD COLUMN IF NOT EXISTS "shipping_fee_in_paise"  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "master_orders"
  ADD CONSTRAINT "master_orders_shipping_option_id_fkey"
  FOREIGN KEY ("shipping_option_id") REFERENCES "shipping_options"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
