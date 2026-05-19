-- Phase 27 (2026-05-18) — Section 194-O Income-Tax TDS ledger
-- + denormalised columns on seller_settlements + admin attestation
-- columns on sellers.
--
-- See apps/api/prisma/schema/income-tax-tds.prisma for the model
-- documentation. The TDS lifecycle parallels GST TCS (Phase 16)
-- but on GROSS sale value and quarterly cadence.

-- 1. Enum --------------------------------------------------------
CREATE TYPE "Tds194OStatus" AS ENUM (
    'COMPUTED',
    'WITHHELD',
    'DEPOSITED',
    'CERTIFICATE_ISSUED',
    'REVERSED'
);

-- 2. Main ledger table ------------------------------------------
CREATE TABLE "section_194o_tds_ledger" (
    "id"                                 TEXT NOT NULL,

    "seller_id"                          TEXT NOT NULL,
    "filing_period"                      TEXT NOT NULL,

    "seller_pan_number"                  TEXT,
    "seller_pan_last_4"                  TEXT,
    "seller_legal_name"                  TEXT,
    "had_verified_pan"                   BOOLEAN NOT NULL DEFAULT false,

    "gross_sale_in_paise"                BIGINT NOT NULL DEFAULT 0,
    "refund_reversal_in_paise"           BIGINT NOT NULL DEFAULT 0,
    "net_sale_in_paise"                  BIGINT NOT NULL DEFAULT 0,
    "adjustment_carried_forward_in_paise" BIGINT NOT NULL DEFAULT 0,

    "tds_rate_bps"                       INTEGER NOT NULL DEFAULT 100,
    "tds_in_paise"                       BIGINT NOT NULL DEFAULT 0,

    "status"                             "Tds194OStatus" NOT NULL DEFAULT 'COMPUTED',

    "computed_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by"                        TEXT,
    "computed_reason"                    TEXT,
    "withheld_at"                        TIMESTAMP(3),
    "settlement_id"                      TEXT,
    "deposited_at"                       TIMESTAMP(3),
    "deposited_by"                       TEXT,
    "challan_reference"                  TEXT,
    "certificate_issued_at"              TIMESTAMP(3),
    "certificate_issued_by"              TEXT,
    "certificate_number"                 TEXT,

    "correction_of_id"                   TEXT,

    "created_at"                         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_194o_tds_ledger_pkey" PRIMARY KEY ("id")
);

-- Active-row uniqueness: a seller may have at most one non-REVERSED
-- row per (sellerId, filingPeriod). Mirrors the TCS pattern.
CREATE UNIQUE INDEX "section_194o_tds_ledger_seller_period_active_uniq"
    ON "section_194o_tds_ledger" ("seller_id", "filing_period")
    WHERE "status" <> 'REVERSED';

CREATE INDEX "section_194o_tds_ledger_seller_period_idx"
    ON "section_194o_tds_ledger" ("seller_id", "filing_period");
CREATE INDEX "section_194o_tds_ledger_filing_period_idx"
    ON "section_194o_tds_ledger" ("filing_period");
CREATE INDEX "section_194o_tds_ledger_status_idx"
    ON "section_194o_tds_ledger" ("status");

ALTER TABLE "section_194o_tds_ledger"
    ADD CONSTRAINT "section_194o_tds_ledger_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Denormalised columns on seller_settlements -----------------
-- Mirrors the existing tcs_* columns. Default to 0 / null so
-- existing rows don't need a backfill — the hook stamps them when
-- the next cycle is approved.
ALTER TABLE "seller_settlements"
    ADD COLUMN "tds_ledger_id"        TEXT,
    ADD COLUMN "tds_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "tds_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN "tds_filing_period"    TEXT;

ALTER TABLE "seller_settlements"
    ADD CONSTRAINT "seller_settlements_tds_ledger_id_fkey"
    FOREIGN KEY ("tds_ledger_id") REFERENCES "section_194o_tds_ledger"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Admin-attested Section 194-O exemption on sellers ----------
-- Sub-threshold individual / HUF sellers — admin flips this true
-- after reviewing projected annual gross. Cleared on annual review
-- if projected gross now exceeds the threshold.
ALTER TABLE "sellers"
    ADD COLUMN "is_194o_exempt"           BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "exempt_194o_reason"       TEXT,
    ADD COLUMN "exempt_194o_attested_by"  TEXT,
    ADD COLUMN "exempt_194o_attested_at"  TIMESTAMP(3);
