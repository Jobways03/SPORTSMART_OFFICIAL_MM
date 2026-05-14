-- Phase 15 GST — E-way bills (Electronic Way Bills, CBIC Rule 138).
--
-- Required for consignments above ₹50,000 (default; some states have
-- higher intra-state thresholds — captured in tax_config). One EWB per
-- sub-order (per CBIC convention for multi-package consignments).
--
-- This migration ships the table + enums. The actual provider integration
-- is stubbed in Phase 15 (`EWAY_BILL_PROVIDER=stub`); NIC e-Waybill API
-- integration lands in a later phase tied to e-invoicing.
--
-- See docs/tax/EWAY_BILL_POLICY.md for the full operational policy.

DO $$
BEGIN
  CREATE TYPE "EWayBillStatus" AS ENUM (
    -- ₹50k threshold not crossed (intra-state below state threshold).
    -- Row exists so the audit trail records the explicit decision.
    'NOT_REQUIRED',
    -- Threshold crossed; awaiting seller to mark PACKED + provide
    -- transport details + adapter call.
    'REQUIRED',
    -- Adapter call in flight (the stub flips this to GENERATED in
    -- one shot; the real NIC adapter may sit here through a retry).
    'PENDING',
    -- Successfully issued — EWB number assigned, validUntil populated.
    'GENERATED',
    -- Cancelled within 24h of generation.
    'CANCELLED',
    -- Past validUntil without delivery; AdminTask `EWAY_BILL_EXPIRED`
    -- raised.
    'EXPIRED',
    -- All retries exhausted; AdminTask `EWAY_BILL_GENERATION_FAILED`
    -- raised; seller cannot ship until resolved.
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE "EWayBillTransportMode" AS ENUM (
    'ROAD',
    'RAIL',
    'AIR',
    'SHIP'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- New AdminTaskKind values for EWB workflows. Add IF NOT EXISTS so
-- re-running the migration on a partially-loaded enum is safe.
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'EWAY_BILL_GENERATION_FAILED';
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'EWAY_BILL_EXPIRED';

CREATE TABLE IF NOT EXISTS "e_way_bills" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  -- Linkage. sub_order_id is the unique business key — one EWB per
  -- sub-order, regardless of how many packages it ships in.
  "sub_order_id"        TEXT NOT NULL,
  -- Cross-reference to the tax_document for this sub-order; null only
  -- if the invoice generator failed (shouldn't happen in practice).
  "tax_document_id"     TEXT,

  -- Issuer GSTIN — same as the source invoice's supplier GSTIN.
  -- Captured here so EWB reports can be filtered by supplier without
  -- joining back to tax_documents.
  "supplier_gstin"      TEXT,

  -- Provider-side identifiers. ewb_number is null until status =
  -- GENERATED. For the stub: "EWB-STUB-<uuid>". For NIC: the 12-digit
  -- e-way bill number.
  "ewb_number"          TEXT,
  "ewb_date"            TIMESTAMPTZ,
  "valid_until"         TIMESTAMPTZ,

  -- Provider attribution. 'stub' in dev; 'nic' in prod (when wired).
  "provider"            TEXT NOT NULL DEFAULT 'stub',

  -- Transport metadata
  "transport_mode"      "EWayBillTransportMode" NOT NULL DEFAULT 'ROAD',
  "vehicle_number"      TEXT,
  "transporter_id"      TEXT,
  "transporter_name"    TEXT,

  -- Origin + destination snapshot (from sub-order pickup + customer
  -- shipping addresses at EWB-generation time). Captured separately
  -- from the addresses themselves so a later address edit doesn't
  -- silently change the EWB record.
  "from_pincode"        TEXT,
  "from_state_code"     TEXT,
  "to_pincode"          TEXT,
  "to_state_code"       TEXT,
  "distance_km"         INT,

  -- Consignment value used to decide if the EWB was required. Snapshot
  -- of the invoice total at generation time (post-discount, incl. GST
  -- and shipping). BigInt paise.
  "consignment_value_in_paise" BIGINT NOT NULL,

  "status"              "EWayBillStatus" NOT NULL DEFAULT 'NOT_REQUIRED',

  -- Cancellation + failure audit
  "cancelled_at"        TIMESTAMPTZ,
  "cancelled_by"        TEXT,
  "cancellation_reason" TEXT,
  "failure_reason"      TEXT,
  "retry_count"         INT NOT NULL DEFAULT 0,

  -- Raw provider request / response JSON. Captured for dev visibility
  -- (stub) + for production support (NIC payload reproducibility).
  "raw_request_json"    JSONB,
  "raw_response_json"   JSONB,

  -- Admin override audit — set when an admin marks ship-allowed
  -- despite EWB being REQUIRED/FAILED. Tied to permission
  -- `tax.ewayBill.override`.
  "override_admin_id"   TEXT,
  "override_at"         TIMESTAMPTZ,
  "override_reason"     TEXT,

  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "e_way_bills_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────
-- One EWB per sub-order (per CBIC convention). Existing rows that
-- end up CANCELLED don't block new ones: the partial unique index
-- treats CANCELLED as not-present.
CREATE UNIQUE INDEX IF NOT EXISTS "e_way_bills_sub_order_active_uniq"
  ON "e_way_bills" ("sub_order_id")
  WHERE "status" != 'CANCELLED';

-- EWB number unique within provider when present (stub UUIDs and NIC
-- 12-digit numbers must not collide).
CREATE UNIQUE INDEX IF NOT EXISTS "e_way_bills_ewb_number_uniq"
  ON "e_way_bills" ("provider", "ewb_number")
  WHERE "ewb_number" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "e_way_bills_status_idx"
  ON "e_way_bills" ("status");
CREATE INDEX IF NOT EXISTS "e_way_bills_supplier_gstin_idx"
  ON "e_way_bills" ("supplier_gstin");
-- Expiry sweeper: WHERE status='GENERATED' AND valid_until < now().
CREATE INDEX IF NOT EXISTS "e_way_bills_expiry_idx"
  ON "e_way_bills" ("valid_until")
  WHERE "status" = 'GENERATED';
-- Retry queue: WHERE status='FAILED' AND retry_count < max.
CREATE INDEX IF NOT EXISTS "e_way_bills_retry_idx"
  ON "e_way_bills" ("status", "retry_count")
  WHERE "status" = 'FAILED';

-- ── Foreign keys ─────────────────────────────────────────────────
-- RESTRICT on delete so an EWB row cannot disappear because its
-- sub-order was deleted; the audit trail must outlive the order.
DO $$
BEGIN
  ALTER TABLE "e_way_bills"
    ADD CONSTRAINT "e_way_bills_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "e_way_bills"
    ADD CONSTRAINT "e_way_bills_tax_document_id_fkey"
    FOREIGN KEY ("tax_document_id") REFERENCES "tax_documents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
