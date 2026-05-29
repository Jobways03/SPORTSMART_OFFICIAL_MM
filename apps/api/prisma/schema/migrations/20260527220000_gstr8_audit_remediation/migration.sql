-- Phase 159z (GSTR-8 export-flow audit remediation).
--
-- Closes three concrete schema gaps surfaced by the audit:
--
--   #4  Per-place-of-supply breakdown so the CBIC GSTR-8 §3 export can
--       emit one row per (supplier, place-of-supply) instead of a
--       single rolled-up row that hides the inter-state legs.
--       `place_of_supply_breakdown_json` is populated at compute time
--       from the underlying tax_documents.place_of_supply_state_code,
--       and the GSTR-8 CSV / JSON exporter iterates it on emit.
--
--   #5  Concurrent computeForSeller calls for the same (seller,
--       filing_period) used to be application-level-only — the schema
--       had only @@index, no uniqueness. A partial-unique index is the
--       correct tool here because the correction-flow (reverse + recompute)
--       intentionally keeps a chain of REVERSED rows for the same
--       (seller, period) alongside one active row. The WHERE clause
--       restricts uniqueness to non-REVERSED rows so the chain stays
--       legal; concurrent active inserts now collide at the DB.
--       Note: seller_id IS NULL is excluded so platform-direct rows
--       (OWN_BRAND / SPORTSMART) which we never actually write today
--       wouldn't be affected if that policy changed later.
--       The composite (seller_id, filing_period) index also supports
--       the active-row lookup that previously did a sequential filter
--       on top of the filing_period-only index.
--
--   #6  `nic_arn` column captures the GSTN Acknowledgement Reference
--       Number stamped on the row at mark-filed time. Without it a
--       FILED status was unprovable (compare with PAID_TO_GOVT, which
--       already requires payment_reference). Required from Phase 159z
--       onward; existing rows nullable since they predate the column.

-- 1. Per-place-of-supply breakdown column. JSONB is preferred over JSON
--    so PostgreSQL can index / query inside the breakdown later without
--    a migration.
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "place_of_supply_breakdown_json" JSONB NOT NULL DEFAULT '[]'::JSONB;

-- 2. NIC GSTR-8 acknowledgement number (audit #6).
ALTER TABLE "gst_tcs_settlement_ledger"
  ADD COLUMN "nic_arn" TEXT;

-- 3. Composite (seller_id, filing_period) supporting index (audit #5).
CREATE INDEX "gst_tcs_settlement_ledger_seller_id_filing_period_idx"
  ON "gst_tcs_settlement_ledger" ("seller_id", "filing_period");

-- 4. Partial-unique index across active (non-REVERSED) rows only — the
--    correction chain (REVERSED + recompute pair) stays legal but the
--    concurrent-compute race is closed at the DB layer.
CREATE UNIQUE INDEX "gst_tcs_settlement_ledger_active_unique"
  ON "gst_tcs_settlement_ledger" ("seller_id", "filing_period")
  WHERE "status" <> 'REVERSED' AND "seller_id" IS NOT NULL;
