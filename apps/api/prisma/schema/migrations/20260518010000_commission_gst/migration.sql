-- Phase 28 (2026-05-18) — 18% GST on marketplace commission.
--
-- See apps/api/prisma/schema/settlements.prisma and the domain
-- helper at apps/api/src/modules/tax/domain/commission-gst-calculator.ts
-- for the legal background.

ALTER TABLE "seller_settlements"
    ADD COLUMN "commission_gst_rate_bps"                INTEGER NOT NULL DEFAULT 1800,
    ADD COLUMN "commission_gst_split_type"              TEXT,
    ADD COLUMN "cgst_on_commission_in_paise"            BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "sgst_on_commission_in_paise"            BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "igst_on_commission_in_paise"            BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "total_commission_gst_in_paise"          BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "commission_gst_marketplace_state_code"  TEXT,
    ADD COLUMN "commission_gst_seller_state_code"       TEXT;

-- Index supporting the per-state GSTR-1 outward-supply rollup of
-- marketplace commission supply. The marketplace files this in its
-- own GSTR-1 under SAC 9985 grouped by (sellerStateCode, period).
CREATE INDEX "seller_settlements_commission_gst_seller_state_idx"
    ON "seller_settlements" ("commission_gst_seller_state_code");
