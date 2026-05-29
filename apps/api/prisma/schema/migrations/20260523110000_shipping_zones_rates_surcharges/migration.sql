-- Phase 91 (2026-05-23) — zones, rates, surcharges, quote audit, +
-- order-level shipping snapshots.

-- 1. ShippingOption augmentations.
ALTER TABLE "shipping_options"
  ADD COLUMN "active_from"            TIMESTAMP(3),
  ADD COLUMN "active_until"           TIMESTAMP(3),
  ADD COLUMN "seller_id"              TEXT,
  ADD COLUMN "price_is_tax_inclusive" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "tax_hsn_code"           TEXT,
  ADD COLUMN "tax_gst_rate_bps"       INTEGER;

CREATE UNIQUE INDEX "shipping_options_name_key"
  ON "shipping_options" ("name");
DROP INDEX IF EXISTS "shipping_options_is_active_idx";
DROP INDEX IF EXISTS "shipping_options_sort_order_idx";
CREATE INDEX "shipping_options_is_active_sort_order_idx"
  ON "shipping_options" ("is_active", "sort_order");
CREATE INDEX "shipping_options_seller_id_is_active_idx"
  ON "shipping_options" ("seller_id", "is_active");
CREATE INDEX "shipping_options_active_from_active_until_idx"
  ON "shipping_options" ("active_from", "active_until");

-- 2. ShippingZone.
CREATE TABLE "shipping_zones" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL UNIQUE,
  "pincodes"     TEXT[] NOT NULL DEFAULT '{}',
  "states"       TEXT[] NOT NULL DEFAULT '{}',
  "regions"      TEXT[] NOT NULL DEFAULT '{}',
  "priority"     INTEGER NOT NULL DEFAULT 0,
  "is_active"    BOOLEAN NOT NULL DEFAULT TRUE,
  "active_from"  TIMESTAMP(3),
  "active_until" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX "shipping_zones_is_active_priority_idx"
  ON "shipping_zones" ("is_active", "priority");
-- GIN index for pincode containment lookup at scale.
CREATE INDEX "shipping_zones_pincodes_gin"
  ON "shipping_zones" USING GIN ("pincodes");
CREATE INDEX "shipping_zones_states_gin"
  ON "shipping_zones" USING GIN ("states");

-- 3. ShippingZoneOption (m:n).
CREATE TABLE "shipping_zone_options" (
  "zone_id"   TEXT NOT NULL,
  "option_id" TEXT NOT NULL,
  CONSTRAINT "shipping_zone_options_pkey" PRIMARY KEY ("zone_id", "option_id"),
  CONSTRAINT "shipping_zone_options_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE,
  CONSTRAINT "shipping_zone_options_option_id_fkey"
    FOREIGN KEY ("option_id") REFERENCES "shipping_options"("id") ON DELETE CASCADE
);

-- 4. ShippingRate (weight × value slab).
CREATE TABLE "shipping_rates" (
  "id"               TEXT PRIMARY KEY,
  "option_id"        TEXT NOT NULL,
  "zone_id"          TEXT,
  "min_weight_grams" INTEGER NOT NULL DEFAULT 0,
  "max_weight_grams" INTEGER,
  "min_cart_paise"   BIGINT NOT NULL DEFAULT 0,
  "max_cart_paise"   BIGINT,
  "base_paise"       BIGINT NOT NULL DEFAULT 0,
  "per_kg_paise"     BIGINT NOT NULL DEFAULT 0,
  "per_kg_step"      INTEGER NOT NULL DEFAULT 500,
  "is_active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipping_rates_option_id_fkey"
    FOREIGN KEY ("option_id") REFERENCES "shipping_options"("id") ON DELETE CASCADE,
  CONSTRAINT "shipping_rates_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL
);
CREATE INDEX "shipping_rates_option_id_zone_id_is_active_idx"
  ON "shipping_rates" ("option_id", "zone_id", "is_active");
CREATE INDEX "shipping_rates_zone_id_idx"
  ON "shipping_rates" ("zone_id");

-- 5. ShippingSurcharge.
CREATE TABLE "shipping_surcharges" (
  "id"             TEXT PRIMARY KEY,
  "name"           TEXT NOT NULL UNIQUE,
  "kind"           "ShippingSurchargeKind" NOT NULL,
  "zone_id"        TEXT,
  "option_id"      TEXT,
  "value_type"     "ShippingSurchargeValueType" NOT NULL,
  "value"          BIGINT NOT NULL,
  "min_cart_paise" BIGINT,
  "max_cap_paise"  BIGINT,
  "stacking_order" INTEGER NOT NULL DEFAULT 100,
  "is_active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipping_surcharges_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL,
  CONSTRAINT "shipping_surcharges_option_id_fkey"
    FOREIGN KEY ("option_id") REFERENCES "shipping_options"("id") ON DELETE SET NULL
);
CREATE INDEX "shipping_surcharges_kind_is_active_stacking_order_idx"
  ON "shipping_surcharges" ("kind", "is_active", "stacking_order");
CREATE INDEX "shipping_surcharges_zone_id_idx"
  ON "shipping_surcharges" ("zone_id");
CREATE INDEX "shipping_surcharges_option_id_idx"
  ON "shipping_surcharges" ("option_id");

-- 6. ShippingQuoteAudit.
CREATE TABLE "shipping_quote_audits" (
  "id"                       TEXT PRIMARY KEY,
  "cart_id"                  TEXT,
  "master_order_id"          TEXT,
  "actor_type"               TEXT NOT NULL,
  "actor_id"                 TEXT,
  "net_cart_value_in_paise"  BIGINT NOT NULL,
  "total_weight_grams"       INTEGER,
  "destination_pincode"      TEXT,
  "origin_pincode"           TEXT,
  "buyer_state_code"         TEXT,
  "payment_method"           TEXT,
  "matched_zone_id"          TEXT,
  "matched_rate_id"          TEXT,
  "selected_option_id"       TEXT,
  "base_fee_in_paise"        BIGINT NOT NULL,
  "surcharges_applied_json"  JSONB,
  "fee_in_paise"             BIGINT NOT NULL,
  "taxable_in_paise"         BIGINT NOT NULL DEFAULT 0,
  "cgst_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "sgst_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "igst_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "computed_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipping_quote_audits_matched_zone_id_fkey"
    FOREIGN KEY ("matched_zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL
);
CREATE INDEX "shipping_quote_audits_cart_id_computed_at_idx"
  ON "shipping_quote_audits" ("cart_id", "computed_at");
CREATE INDEX "shipping_quote_audits_master_order_id_idx"
  ON "shipping_quote_audits" ("master_order_id");
CREATE INDEX "shipping_quote_audits_selected_option_id_computed_at_idx"
  ON "shipping_quote_audits" ("selected_option_id", "computed_at");

-- 7. MasterOrder snapshot extensions.
ALTER TABLE "master_orders"
  ADD COLUMN "shipping_option_price_in_paise_snapshot"     BIGINT,
  ADD COLUMN "shipping_option_rate_type_snapshot"          TEXT,
  ADD COLUMN "shipping_option_threshold_in_paise_snapshot" BIGINT,
  ADD COLUMN "shipping_zone_id_snapshot"                   TEXT,
  ADD COLUMN "shipping_surcharges_json_snapshot"           JSONB,
  ADD COLUMN "shipping_taxable_in_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "shipping_cgst_in_paise"    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "shipping_sgst_in_paise"    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "shipping_igst_in_paise"    BIGINT NOT NULL DEFAULT 0;
