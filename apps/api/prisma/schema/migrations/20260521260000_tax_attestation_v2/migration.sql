-- Phase 45 (2026-05-21) — Tax-config attestation v2.
--
-- Three concerns covered:
--   1. tax_config_version    — monotonic counter on the Product row.
--      Increment on every tax-column write so the verify endpoint
--      can optimistic-lock against the version the admin reviewed
--      (closes audit Gap #8 read-then-write race).
--
--   2. tax_attestation_logs  — append-only audit trail of every
--      attestation/reset/edit transition. CA-compliance audits demand
--      the chain, not just the latest writer (audit Gap #6).
--
--   3. Format CHECK constraints on hsn_code / default_uqc_code /
--      gst_rate_bps / cess_rate_bps. Even if someone bypasses the
--      DTO (background job, direct SQL), Postgres refuses bad data
--      (audit Gap #14).

-- ─── 1. Product.tax_config_version ─────────────────────────────

ALTER TABLE "products"
  ADD COLUMN "tax_config_version" INTEGER NOT NULL DEFAULT 0;

-- ─── 2. TaxAttestationLog table + enum ────────────────────────

CREATE TYPE "TaxAttestationAction" AS ENUM (
  'ATTESTED',
  'RESET',
  'EDITED',
  'BULK_EDITED'
);

CREATE TABLE "tax_attestation_logs" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "action" "TaxAttestationAction" NOT NULL,
  "prev_hsn" TEXT,
  "prev_gst_rate_bps" INTEGER,
  "prev_supply_taxability" TEXT,
  "prev_uqc_code" TEXT,
  "new_hsn" TEXT,
  "new_gst_rate_bps" INTEGER,
  "new_supply_taxability" TEXT,
  "new_uqc_code" TEXT,
  "tax_config_version" INTEGER NOT NULL,
  "actor_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "reviewer_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tax_attestation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tax_attestation_logs_product_id_created_at_idx"
  ON "tax_attestation_logs" ("product_id", "created_at");

CREATE INDEX "tax_attestation_logs_actor_id_created_at_idx"
  ON "tax_attestation_logs" ("actor_id", "created_at");

ALTER TABLE "tax_attestation_logs"
  ADD CONSTRAINT "tax_attestation_logs_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. Format CHECK constraints ──────────────────────────────
--
-- The DTO layer already validates these regexes on the write paths;
-- the CHECK is defence-in-depth for direct DB writes, background
-- jobs, and import scripts.

ALTER TABLE "products"
  ADD CONSTRAINT "products_hsn_code_format_check"
  CHECK (hsn_code IS NULL OR hsn_code = '' OR hsn_code ~ '^\d{4,8}$');

ALTER TABLE "products"
  ADD CONSTRAINT "products_default_uqc_code_format_check"
  CHECK (default_uqc_code IS NULL OR default_uqc_code = '' OR default_uqc_code ~ '^[A-Z]{2,6}$');

-- Phase 45 — tighten gst_rate_bps + cess_rate_bps to [0, 10000].
-- The pre-Phase-45 bulk endpoint capped gst_rate_bps at 4000 in code
-- but the schema accepted any int. Pin the contract here so future
-- bulk paths can't slip 5000+ through.
ALTER TABLE "products"
  ADD CONSTRAINT "products_gst_rate_bps_range_check"
  CHECK (gst_rate_bps BETWEEN 0 AND 10000);

ALTER TABLE "products"
  ADD CONSTRAINT "products_cess_rate_bps_range_check"
  CHECK (cess_rate_bps BETWEEN 0 AND 10000);
