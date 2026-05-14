-- Phase 1 of the GST/tax/invoice system — master data schema.
-- See docs/tax/CA.md (especially §A phase log) for the comprehensive
-- context and CA-decision items this phase touches.
--
-- This migration is PURELY ADDITIVE:
--   - new enums (SupplyTaxability, GstRegistrationType, TaxLineType,
--     TaxSplitType, SupplierType)
--   - new tables (india_states, uqc_master, hsn_master,
--     seller_gstins, customer_tax_profiles, platform_gst_profiles,
--     tax_config)
--   - new columns on products / product_variants / sellers, all
--     nullable or with safe defaults so existing rows continue to work.
--
-- No backfill is required. Existing checkout / order flows are
-- unaffected — feature flags (GST_TAX_ENABLED, TAX_STRICT_MODE)
-- control when the new fields start gating behaviour.

-- ─── Enums ──────────────────────────────────────────────────────

CREATE TYPE "SupplyTaxability" AS ENUM (
  'TAXABLE',
  'NIL_RATED',
  'EXEMPT',
  'NON_GST',
  'ZERO_RATED',
  'OUT_OF_SCOPE'
);

CREATE TYPE "GstRegistrationType" AS ENUM (
  'REGULAR',
  'COMPOSITION',
  'UNREGISTERED'
);

CREATE TYPE "TaxLineType" AS ENUM (
  'PRODUCT',
  'SHIPPING',
  'GIFT_WRAP',
  'CONVENIENCE_FEE',
  'COD_FEE',
  'ROUND_OFF',
  'DISCOUNT_ADJUSTMENT'
);

CREATE TYPE "TaxSplitType" AS ENUM (
  'CGST_SGST',
  'IGST'
);

CREATE TYPE "SupplierType" AS ENUM (
  'MARKETPLACE_SELLER',
  'FRANCHISE',
  'OWN_BRAND',
  'SPORTSMART'
);

-- ─── Master / lookup tables ─────────────────────────────────────

CREATE TABLE "india_states" (
  "id"                  TEXT NOT NULL,
  "gst_state_code"      TEXT NOT NULL,
  "state_name"          TEXT NOT NULL,
  "iso_code"            TEXT,
  "is_union_territory"  BOOLEAN NOT NULL DEFAULT false,
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "india_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "india_states_gst_state_code_key" ON "india_states"("gst_state_code");

CREATE TABLE "uqc_master" (
  "id"            TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "uqc_master_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uqc_master_code_key" ON "uqc_master"("code");

CREATE TABLE "hsn_master" (
  "id"                    TEXT NOT NULL,
  "hsn_code"              TEXT NOT NULL,
  "description"           TEXT NOT NULL,
  "default_gst_rate_bps"  INTEGER NOT NULL DEFAULT 0,
  "supply_taxability"     "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE',
  "default_uqc_code"      TEXT,
  "category_hint"         TEXT,
  "is_active"             BOOLEAN NOT NULL DEFAULT true,
  "effective_from"        TIMESTAMP(3) NOT NULL,
  "effective_to"          TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hsn_master_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hsn_master_code_effective_uniq" ON "hsn_master"("hsn_code", "effective_from");
CREATE INDEX "hsn_master_hsn_code_idx" ON "hsn_master"("hsn_code");
CREATE INDEX "hsn_master_is_active_effective_from_idx" ON "hsn_master"("is_active", "effective_from");

-- ─── Supplier / customer tax profiles ───────────────────────────

CREATE TABLE "seller_gstins" (
  "id"                   TEXT NOT NULL,
  "seller_id"            TEXT NOT NULL,
  "gstin"                TEXT NOT NULL,
  "state_code"           TEXT NOT NULL,
  "legal_name"           TEXT NOT NULL,
  "address_json"         JSONB NOT NULL,
  "is_primary"           BOOLEAN NOT NULL DEFAULT false,
  "is_active"            BOOLEAN NOT NULL DEFAULT true,
  "registration_type"    "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
  "verified_at"          TIMESTAMP(3),
  "verified_by"          TEXT,
  "verification_notes"   TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_gstins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_gstins_seller_gstin_uniq" ON "seller_gstins"("seller_id", "gstin");
CREATE UNIQUE INDEX "seller_gstins_gstin_global_uniq" ON "seller_gstins"("gstin");
CREATE INDEX "seller_gstins_seller_id_is_active_idx" ON "seller_gstins"("seller_id", "is_active");
CREATE INDEX "seller_gstins_state_code_idx" ON "seller_gstins"("state_code");
CREATE INDEX "seller_gstins_registration_type_idx" ON "seller_gstins"("registration_type");
ALTER TABLE "seller_gstins" ADD CONSTRAINT "seller_gstins_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "customer_tax_profiles" (
  "id"                   TEXT NOT NULL,
  "customer_id"          TEXT NOT NULL,
  "gstin"                TEXT NOT NULL,
  "legal_name"           TEXT NOT NULL,
  "billing_address_json" JSONB NOT NULL,
  "state_code"           TEXT NOT NULL,
  "is_default"           BOOLEAN NOT NULL DEFAULT false,
  "is_verified"          BOOLEAN NOT NULL DEFAULT false,
  "verified_at"          TIMESTAMP(3),
  "verified_by"          TEXT,
  "verification_notes"   TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_tax_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_tax_profiles_user_gstin_uniq" ON "customer_tax_profiles"("customer_id", "gstin");
CREATE INDEX "customer_tax_profiles_customer_id_is_default_idx" ON "customer_tax_profiles"("customer_id", "is_default");
CREATE INDEX "customer_tax_profiles_gstin_idx" ON "customer_tax_profiles"("gstin");
ALTER TABLE "customer_tax_profiles" ADD CONSTRAINT "customer_tax_profiles_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_gst_profiles" (
  "id"                       TEXT NOT NULL,
  "legal_business_name"      TEXT NOT NULL,
  "gstin"                    TEXT NOT NULL,
  "registered_address_json"  JSONB NOT NULL,
  "gst_state_code"           TEXT NOT NULL,
  "registration_type"        "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
  "pan_number"               TEXT,
  "pan_last_4"               TEXT,
  "pan_verified"             BOOLEAN NOT NULL DEFAULT false,
  "is_default"               BOOLEAN NOT NULL DEFAULT false,
  "is_active"                BOOLEAN NOT NULL DEFAULT true,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_gst_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_gst_profiles_gstin_key" ON "platform_gst_profiles"("gstin");
CREATE INDEX "platform_gst_profiles_is_default_is_active_idx" ON "platform_gst_profiles"("is_default", "is_active");
CREATE INDEX "platform_gst_profiles_gst_state_code_idx" ON "platform_gst_profiles"("gst_state_code");

CREATE TABLE "tax_config" (
  "id"          TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "value"       JSONB NOT NULL,
  "description" TEXT,
  "updated_by"  TEXT,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tax_config_key_key" ON "tax_config"("key");

-- ─── Product / Variant / Seller column additions ────────────────

ALTER TABLE "products"
  ADD COLUMN "hsn_code"                TEXT,
  ADD COLUMN "gst_rate_bps"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "supply_taxability"       "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE',
  ADD COLUMN "tax_inclusive_pricing"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cess_rate_bps"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "default_uqc_code"        TEXT,
  ADD COLUMN "tax_category"            TEXT,
  ADD COLUMN "tax_config_updated_by"   TEXT,
  ADD COLUMN "tax_config_updated_at"   TIMESTAMP(3);

ALTER TABLE "product_variants"
  ADD COLUMN "gst_rate_bps_override"           INTEGER,
  ADD COLUMN "hsn_code_override"               TEXT,
  ADD COLUMN "tax_inclusive_pricing_override"  BOOLEAN,
  ADD COLUMN "uqc_code_override"               TEXT;

ALTER TABLE "sellers"
  ADD COLUMN "gstin"                              TEXT,
  ADD COLUMN "legal_business_name"                TEXT,
  ADD COLUMN "registered_business_address_json"   JSONB,
  ADD COLUMN "gst_state_code"                     TEXT,
  ADD COLUMN "gst_registration_type"              "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "is_gst_verified"                    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gst_verified_at"                    TIMESTAMP(3),
  ADD COLUMN "gst_verified_by"                    TEXT,
  ADD COLUMN "gst_verification_notes"             TEXT,
  ADD COLUMN "pan_number"                         TEXT,
  ADD COLUMN "pan_last_4"                         TEXT,
  ADD COLUMN "pan_verified"                       BOOLEAN NOT NULL DEFAULT false;

-- ─── Helpful indexes on new product columns ─────────────────────

CREATE INDEX "products_hsn_code_idx" ON "products"("hsn_code");
CREATE INDEX "products_supply_taxability_idx" ON "products"("supply_taxability");
CREATE INDEX "sellers_gstin_idx" ON "sellers"("gstin");
CREATE INDEX "sellers_gst_state_code_idx" ON "sellers"("gst_state_code");
CREATE INDEX "sellers_gst_registration_type_idx" ON "sellers"("gst_registration_type");
