-- Phase 108 (2026-05-25) — B2B / off-platform seller return reversal.
--
-- Replaces the unaudited self-serve POST /seller/orders/:id/return with a
-- persisted, admin-approved reversal. See prisma/schema/seller-reversal.prisma.

-- New status enum for the reversal lifecycle.
CREATE TYPE "SellerReversalStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

-- New provenance values on existing ledger/commission enums. Not referenced
-- by any statement in this migration, so the Postgres "new enum value cannot
-- be used in the same transaction" rule is not triggered.
ALTER TYPE "LedgerSourceType" ADD VALUE 'SELLER_REVERSAL';
ALTER TYPE "CommissionReversalSource" ADD VALUE 'SELLER_REVERSAL';

-- Per-item over-reversal guard + customer-facing-status decoupling.
ALTER TABLE "order_items" ADD COLUMN "reversed_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sub_orders" ADD COLUMN "seller_reversal_status" "SellerReversalStatus";

CREATE TABLE "seller_reversals" (
  "id"                       TEXT NOT NULL,
  "sub_order_id"             TEXT NOT NULL,
  "seller_id"                TEXT NOT NULL,
  "master_order_id"          TEXT NOT NULL,
  "status"                   "SellerReversalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "reason"                   TEXT NOT NULL,
  "reversal_value_in_paise"  BIGINT NOT NULL,
  "requested_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_admin_id"      TEXT,
  "decided_at"               TIMESTAMP(3),
  "rejection_reason"         TEXT,
  "seller_debit_id"          TEXT,
  "idempotency_key"          TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_reversals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seller_reversal_items" (
  "id"                  TEXT NOT NULL,
  "reversal_id"         TEXT NOT NULL,
  "order_item_id"       TEXT NOT NULL,
  "product_id"          TEXT NOT NULL,
  "variant_id"          TEXT,
  "quantity"            INTEGER NOT NULL,
  "unit_price_in_paise" BIGINT NOT NULL,
  CONSTRAINT "seller_reversal_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_reversals_idempotency_key_key" ON "seller_reversals"("idempotency_key");
CREATE INDEX "seller_reversals_seller_id_status_requested_at_idx" ON "seller_reversals"("seller_id", "status", "requested_at" DESC);
CREATE INDEX "seller_reversals_status_requested_at_idx" ON "seller_reversals"("status", "requested_at" DESC);
CREATE INDEX "seller_reversals_sub_order_id_idx" ON "seller_reversals"("sub_order_id");

CREATE INDEX "seller_reversal_items_reversal_id_idx" ON "seller_reversal_items"("reversal_id");
CREATE INDEX "seller_reversal_items_order_item_id_idx" ON "seller_reversal_items"("order_item_id");

ALTER TABLE "seller_reversal_items"
  ADD CONSTRAINT "seller_reversal_items_reversal_id_fkey"
  FOREIGN KEY ("reversal_id") REFERENCES "seller_reversals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
