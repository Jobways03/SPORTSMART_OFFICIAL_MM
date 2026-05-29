-- Phase 70 (2026-05-22) — Phase 67 audit Gap #15.
--
-- Per-OrderItem tax-config snapshot captured INSIDE the order
-- transaction so the post-tx TaxSnapshotService never re-reads
-- live product / variant tax columns. Pre-Phase-70 a mid-flow
-- admin edit to gstRateBps drifted the snapshot away from what
-- the customer was actually charged.

CREATE TABLE "order_item_tax_config_snapshots" (
  "id"                    TEXT PRIMARY KEY,
  "order_item_id"         TEXT NOT NULL UNIQUE,
  "hsn_code"              TEXT,
  "gst_rate_bps"          INTEGER NOT NULL DEFAULT 0,
  "supply_taxability"     TEXT NOT NULL DEFAULT 'TAXABLE',
  "price_includes_tax"    BOOLEAN NOT NULL DEFAULT TRUE,
  "cess_rate_bps"         INTEGER NOT NULL DEFAULT 0,
  "uqc_code"              TEXT,
  "product_source"        TEXT,
  "sourced_from_variant"  BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"            TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("order_item_id") REFERENCES "order_items" ("id") ON DELETE CASCADE
);

CREATE INDEX "order_item_tax_config_snapshots_order_item_id_idx"
  ON "order_item_tax_config_snapshots" ("order_item_id");
