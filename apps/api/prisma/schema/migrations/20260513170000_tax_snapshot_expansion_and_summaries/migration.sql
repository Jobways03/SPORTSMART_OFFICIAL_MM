-- Phase 5 of the GST/tax/invoice system — snapshot expansion + summary tables.
--
-- 1. Extends order_item_tax_snapshots with lineType + supplier metadata +
--    pricing-mode + taxability + cess + state codes + GSTIN snapshots +
--    tax-data status + currency + descriptive fields.
-- 2. Adds sub_order_tax_summaries — one row per SubOrder, aggregate of
--    the lines. Drives the seller invoice header in Phase 8.
-- 3. Adds order_tax_summaries — one row per MasterOrder, aggregate
--    across all sub-orders. Used by customer order-detail UI for the
--    "tax summary" panel and reconciliation reports.
--
-- All additions are safe-default. Existing rows continue to work with
-- lineType=PRODUCT, supplyTaxability=TAXABLE, priceIncludesTax=true,
-- currencyCode=INR, taxDataStatus='COMPLETE'. The orderItemId unique
-- constraint is preserved (Phase 7 introduces non-PRODUCT lines and
-- will relax this with a partial index).
--
-- See docs/tax/CA.md §A Phase 5 log.

-- ─── Enums ──────────────────────────────────────────────────────

CREATE TYPE "TaxDataStatus" AS ENUM (
  'COMPLETE',
  'INCOMPLETE',
  'EXEMPT'
);

-- ─── order_item_tax_snapshots — column additions ────────────────

ALTER TABLE "order_item_tax_snapshots"
  ADD COLUMN "line_type"                  "TaxLineType"        NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "supplier_type"              "SupplierType",
  ADD COLUMN "seller_id"                  TEXT,
  ADD COLUMN "product_id"                 TEXT,
  ADD COLUMN "variant_id"                 TEXT,
  ADD COLUMN "description"                TEXT,
  ADD COLUMN "uqc_code"                   TEXT,
  ADD COLUMN "quantity"                   DECIMAL(12, 3),
  ADD COLUMN "supply_taxability"          "SupplyTaxability"   NOT NULL DEFAULT 'TAXABLE',
  ADD COLUMN "price_includes_tax"         BOOLEAN              NOT NULL DEFAULT true,
  ADD COLUMN "cess_rate_bps"              INTEGER              NOT NULL DEFAULT 0,
  ADD COLUMN "cess_amount_in_paise"       BIGINT               NOT NULL DEFAULT 0,
  ADD COLUMN "seller_state_code"          TEXT,
  ADD COLUMN "tax_split_type"             "TaxSplitType",
  ADD COLUMN "reverse_charge_applicable"  BOOLEAN              NOT NULL DEFAULT false,
  ADD COLUMN "currency_code"              TEXT                 NOT NULL DEFAULT 'INR',
  ADD COLUMN "tax_data_status"            "TaxDataStatus"      NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN "seller_gstin"               TEXT,
  ADD COLUMN "buyer_gstin"                TEXT;

-- New indexes for tax reporting + filtering
CREATE INDEX "order_item_tax_snapshots_line_type_idx"         ON "order_item_tax_snapshots"("line_type");
CREATE INDEX "order_item_tax_snapshots_supplier_type_idx"     ON "order_item_tax_snapshots"("supplier_type");
CREATE INDEX "order_item_tax_snapshots_seller_id_idx"         ON "order_item_tax_snapshots"("seller_id");
CREATE INDEX "order_item_tax_snapshots_supply_taxability_idx" ON "order_item_tax_snapshots"("supply_taxability");
CREATE INDEX "order_item_tax_snapshots_tax_data_status_idx"   ON "order_item_tax_snapshots"("tax_data_status");
CREATE INDEX "order_item_tax_snapshots_seller_state_idx"      ON "order_item_tax_snapshots"("seller_state_code");

-- ─── sub_order_tax_summaries ────────────────────────────────────

CREATE TABLE "sub_order_tax_summaries" (
  "id"                                   TEXT NOT NULL,
  "master_order_id"                      TEXT NOT NULL,
  "sub_order_id"                         TEXT NOT NULL,
  "seller_id"                            TEXT,
  "supplier_type"                        "SupplierType",
  "seller_gstin"                         TEXT,
  "seller_state_code"                    TEXT,
  "buyer_gstin"                          TEXT,
  "place_of_supply_state_code"           TEXT,
  "tax_split_type"                       "TaxSplitType",

  "taxable_amount_in_paise"              BIGINT NOT NULL DEFAULT 0,
  "cgst_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "sgst_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "igst_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "total_tax_amount_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "cess_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "round_off_amount_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "invoice_total_in_paise"               BIGINT NOT NULL DEFAULT 0,

  "currency_code"                        TEXT NOT NULL DEFAULT 'INR',
  "tax_data_status"                      "TaxDataStatus" NOT NULL DEFAULT 'COMPLETE',
  "line_count"                           INTEGER NOT NULL DEFAULT 0,

  "created_at"                           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sub_order_tax_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sub_order_tax_summaries_sub_order_id_key" ON "sub_order_tax_summaries"("sub_order_id");
CREATE INDEX "sub_order_tax_summaries_master_order_id_idx"     ON "sub_order_tax_summaries"("master_order_id");
CREATE INDEX "sub_order_tax_summaries_seller_id_idx"           ON "sub_order_tax_summaries"("seller_id");
CREATE INDEX "sub_order_tax_summaries_tax_data_status_idx"     ON "sub_order_tax_summaries"("tax_data_status");
CREATE INDEX "sub_order_tax_summaries_supplier_type_idx"       ON "sub_order_tax_summaries"("supplier_type");

-- Foreign keys — keep light to avoid surprises during inventory cleanup.
-- Cascade on sub-order delete; orphan-protect on seller delete.
ALTER TABLE "sub_order_tax_summaries"
  ADD CONSTRAINT "sub_order_tax_summaries_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sub_order_tax_summaries"
  ADD CONSTRAINT "sub_order_tax_summaries_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── order_tax_summaries ────────────────────────────────────────

CREATE TABLE "order_tax_summaries" (
  "id"                                   TEXT NOT NULL,
  "master_order_id"                      TEXT NOT NULL,

  "taxable_amount_in_paise"              BIGINT NOT NULL DEFAULT 0,
  "cgst_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "sgst_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "igst_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "total_tax_amount_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "cess_amount_in_paise"                 BIGINT NOT NULL DEFAULT 0,
  "round_off_amount_in_paise"            BIGINT NOT NULL DEFAULT 0,
  "invoice_total_in_paise"               BIGINT NOT NULL DEFAULT 0,

  "currency_code"                        TEXT NOT NULL DEFAULT 'INR',
  "tax_data_status"                      "TaxDataStatus" NOT NULL DEFAULT 'COMPLETE',
  "sub_order_count"                      INTEGER NOT NULL DEFAULT 0,
  "line_count"                           INTEGER NOT NULL DEFAULT 0,

  "created_at"                           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_tax_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_tax_summaries_master_order_id_key" ON "order_tax_summaries"("master_order_id");
CREATE INDEX "order_tax_summaries_tax_data_status_idx"        ON "order_tax_summaries"("tax_data_status");

ALTER TABLE "order_tax_summaries"
  ADD CONSTRAINT "order_tax_summaries_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
