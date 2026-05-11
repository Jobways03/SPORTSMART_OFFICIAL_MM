-- Phase B (P0) — Industry-grade discount lifecycle: allocation ledger,
-- liability ledger, redemption lifecycle, forward-compatible child code
-- table, and per-line GST snapshots (orders + return-side credit-note
-- reversal lines).
--
-- Purely additive: new enums, new tables, new columns on `discounts`
-- with safe defaults that preserve current settlement behavior
-- (PLATFORM-funded, GROSS commission basis, TRANSACTIONAL nature).
-- No data migration required; legacy orders without allocation rows
-- continue using existing gross refund logic via service-level
-- fallback.

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE "DiscountFundingType" AS ENUM ('PLATFORM', 'SELLER', 'BRAND', 'SHARED', 'NONE');
CREATE TYPE "DiscountCommissionBasis" AS ENUM ('GROSS', 'NET_AFTER_DISCOUNT', 'SELLER_FUNDED_NET');
CREATE TYPE "DiscountNature" AS ENUM ('TRANSACTIONAL', 'DISPLAY_ONLY');
CREATE TYPE "DiscountSource" AS ENUM ('CODE', 'AUTOMATIC', 'AFFILIATE');
CREATE TYPE "DiscountRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED', 'CANCELLED');
CREATE TYPE "DiscountCodeStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'USED', 'DISABLED');
CREATE TYPE "DiscountLiabilityParty" AS ENUM ('PLATFORM', 'SELLER', 'BRAND', 'SHARED');
CREATE TYPE "DiscountLiabilityStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED', 'SETTLED');

-- =====================================================================
-- DISCOUNTS — funding & nature columns (defaults preserve current behavior)
-- =====================================================================

ALTER TABLE "discounts"
  ADD COLUMN "funding_type" "DiscountFundingType" NOT NULL DEFAULT 'PLATFORM',
  ADD COLUMN "platform_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN "seller_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "brand_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "commission_basis" "DiscountCommissionBasis" NOT NULL DEFAULT 'GROSS',
  ADD COLUMN "funding_notes" TEXT,
  ADD COLUMN "discount_nature" "DiscountNature" NOT NULL DEFAULT 'TRANSACTIONAL';

CREATE INDEX "discounts_funding_type_idx" ON "discounts"("funding_type");

-- =====================================================================
-- DISCOUNT_CODES — forward-compatible child code table (P0.6)
-- =====================================================================

CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "DiscountCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "assigned_customer_id" TEXT,
    "assigned_affiliate_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");
CREATE INDEX "discount_codes_discount_id_idx" ON "discount_codes"("discount_id");
CREATE INDEX "discount_codes_assigned_customer_id_idx" ON "discount_codes"("assigned_customer_id");
CREATE INDEX "discount_codes_assigned_affiliate_id_idx" ON "discount_codes"("assigned_affiliate_id");
CREATE INDEX "discount_codes_status_idx" ON "discount_codes"("status");

ALTER TABLE "discount_codes"
  ADD CONSTRAINT "discount_codes_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- DISCOUNT_REDEMPTIONS — reservation lifecycle (P0.3, P0.4)
-- =====================================================================

CREATE TABLE "discount_redemptions" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "customer_id" TEXT NOT NULL,
    "master_order_id" TEXT,
    "source" "DiscountSource" NOT NULL DEFAULT 'CODE',
    "status" "DiscountRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discount_redemptions_discount_id_idx" ON "discount_redemptions"("discount_id");
CREATE INDEX "discount_redemptions_discount_code_id_idx" ON "discount_redemptions"("discount_code_id");
CREATE INDEX "discount_redemptions_customer_id_idx" ON "discount_redemptions"("customer_id");
CREATE INDEX "discount_redemptions_master_order_id_idx" ON "discount_redemptions"("master_order_id");
CREATE INDEX "discount_redemptions_status_idx" ON "discount_redemptions"("status");
CREATE INDEX "discount_redemptions_expires_at_idx" ON "discount_redemptions"("expires_at");
CREATE UNIQUE INDEX "discount_redemptions_discount_code_id_customer_id_status_id_key"
  ON "discount_redemptions"("discount_code_id", "customer_id", "status", "idempotency_key");

ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_discount_code_id_fkey"
    FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- ORDER_DISCOUNTS — order-level allocation snapshot (P0.1)
-- =====================================================================

CREATE TABLE "order_discounts" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "discount_type" "DiscountType" NOT NULL,
    "discount_method" "DiscountMethod" NOT NULL,
    "discount_nature" "DiscountNature" NOT NULL DEFAULT 'TRANSACTIONAL',
    "source" "DiscountSource" NOT NULL DEFAULT 'CODE',
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "funding_type" "DiscountFundingType" NOT NULL DEFAULT 'PLATFORM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_discounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_discounts_master_order_id_idx" ON "order_discounts"("master_order_id");
CREATE INDEX "order_discounts_discount_id_idx" ON "order_discounts"("discount_id");
CREATE INDEX "order_discounts_discount_code_idx" ON "order_discounts"("discount_code");

ALTER TABLE "order_discounts"
  ADD CONSTRAINT "order_discounts_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_discounts"
  ADD CONSTRAINT "order_discounts_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- ORDER_ITEM_DISCOUNTS — per-item allocation (P0.1)
-- =====================================================================

CREATE TABLE "order_item_discounts" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "discount_type" "DiscountType" NOT NULL,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "funding_type" "DiscountFundingType" NOT NULL DEFAULT 'PLATFORM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_discounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_item_discounts_master_order_id_idx" ON "order_item_discounts"("master_order_id");
CREATE INDEX "order_item_discounts_sub_order_id_idx" ON "order_item_discounts"("sub_order_id");
CREATE INDEX "order_item_discounts_order_item_id_idx" ON "order_item_discounts"("order_item_id");
CREATE INDEX "order_item_discounts_seller_id_idx" ON "order_item_discounts"("seller_id");
CREATE INDEX "order_item_discounts_discount_id_idx" ON "order_item_discounts"("discount_id");

ALTER TABLE "order_item_discounts"
  ADD CONSTRAINT "order_item_discounts_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_item_discounts"
  ADD CONSTRAINT "order_item_discounts_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_item_discounts"
  ADD CONSTRAINT "order_item_discounts_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_item_discounts"
  ADD CONSTRAINT "order_item_discounts_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- DISCOUNT_LIABILITY_LEDGER — source of truth for who bears cost (P0.5)
-- =====================================================================

CREATE TABLE "discount_liability_ledger" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT,
    "order_item_id" TEXT,
    "seller_id" TEXT,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "funding_type" "DiscountFundingType" NOT NULL,
    "liability_party" "DiscountLiabilityParty" NOT NULL,
    "amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "DiscountLiabilityStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_liability_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discount_liability_ledger_master_order_id_idx" ON "discount_liability_ledger"("master_order_id");
CREATE INDEX "discount_liability_ledger_sub_order_id_idx" ON "discount_liability_ledger"("sub_order_id");
CREATE INDEX "discount_liability_ledger_order_item_id_idx" ON "discount_liability_ledger"("order_item_id");
CREATE INDEX "discount_liability_ledger_seller_id_idx" ON "discount_liability_ledger"("seller_id");
CREATE INDEX "discount_liability_ledger_discount_id_idx" ON "discount_liability_ledger"("discount_id");
CREATE INDEX "discount_liability_ledger_liability_party_idx" ON "discount_liability_ledger"("liability_party");
CREATE INDEX "discount_liability_ledger_status_idx" ON "discount_liability_ledger"("status");

ALTER TABLE "discount_liability_ledger"
  ADD CONSTRAINT "discount_liability_ledger_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discount_liability_ledger"
  ADD CONSTRAINT "discount_liability_ledger_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- ORDER_ITEM_TAX_SNAPSHOTS — post-discount GST per line (P0)
-- =====================================================================

CREATE TABLE "order_item_tax_snapshots" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "gross_line_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "cgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "line_total_after_discount_and_tax_in_paise" BIGINT NOT NULL DEFAULT 0,
    "hsn_code" TEXT,
    "place_of_supply" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_tax_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_item_tax_snapshots_order_item_id_key" ON "order_item_tax_snapshots"("order_item_id");
CREATE INDEX "order_item_tax_snapshots_master_order_id_idx" ON "order_item_tax_snapshots"("master_order_id");
CREATE INDEX "order_item_tax_snapshots_sub_order_id_idx" ON "order_item_tax_snapshots"("sub_order_id");

ALTER TABLE "order_item_tax_snapshots"
  ADD CONSTRAINT "order_item_tax_snapshots_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- RETURN_TAX_REVERSAL_LINES — credit-note GST reversal per return item (P0.2)
-- =====================================================================

CREATE TABLE "return_tax_reversal_lines" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "return_item_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "gross_returned_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_credit_note_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "hsn_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_tax_reversal_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "return_tax_reversal_lines_return_id_idx" ON "return_tax_reversal_lines"("return_id");
CREATE INDEX "return_tax_reversal_lines_return_item_id_idx" ON "return_tax_reversal_lines"("return_item_id");
CREATE INDEX "return_tax_reversal_lines_order_item_id_idx" ON "return_tax_reversal_lines"("order_item_id");

ALTER TABLE "return_tax_reversal_lines"
  ADD CONSTRAINT "return_tax_reversal_lines_return_id_fkey"
    FOREIGN KEY ("return_id") REFERENCES "returns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "return_tax_reversal_lines"
  ADD CONSTRAINT "return_tax_reversal_lines_return_item_id_fkey"
    FOREIGN KEY ("return_item_id") REFERENCES "return_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
