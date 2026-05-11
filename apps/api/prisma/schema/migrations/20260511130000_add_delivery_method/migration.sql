-- Migration: Delivery method (iThink vs Self Delivery)
--
-- Adds:
--   * 3 enums: DeliveryMethod, SelfDeliveryStatus, IThinkWarehouseApprovalStatus
--   * Per-seller and per-franchise iThink + self-delivery entitlement columns
--   * Per-SubOrder deliveryMethod + iThink AWB/courier/tracking fields
--   * Per-SubOrder self-delivery status fields
--
-- All new SubOrder columns are NULLABLE: existing rows (the table was
-- truncated minutes before this migration, but other envs may have data)
-- get NULL deliveryMethod meaning "method not yet chosen".

-- ─── Enums ──────────────────────────────────────────────────────────
CREATE TYPE "DeliveryMethod" AS ENUM ('ITHINK_LOGISTICS', 'SELF_DELIVERY');

CREATE TYPE "SelfDeliveryStatus" AS ENUM (
  'PENDING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "IThinkWarehouseApprovalStatus" AS ENUM (
  'NOT_REGISTERED',
  'PENDING',
  'APPROVED',
  'REJECTED'
);

-- ─── sellers ────────────────────────────────────────────────────────
ALTER TABLE "sellers"
  ADD COLUMN "ithink_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "ithink_pickup_address_id" TEXT,
  ADD COLUMN "ithink_warehouse_status" "IThinkWarehouseApprovalStatus"
    NOT NULL DEFAULT 'NOT_REGISTERED',
  ADD COLUMN "ithink_registered_at" TIMESTAMP(3),
  ADD COLUMN "self_delivery_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "self_delivery_pincodes" JSONB;

-- ─── franchise_partners ─────────────────────────────────────────────
ALTER TABLE "franchise_partners"
  ADD COLUMN "ithink_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "ithink_pickup_address_id" TEXT,
  ADD COLUMN "ithink_warehouse_status" "IThinkWarehouseApprovalStatus"
    NOT NULL DEFAULT 'NOT_REGISTERED',
  ADD COLUMN "ithink_registered_at" TIMESTAMP(3),
  ADD COLUMN "self_delivery_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "self_delivery_pincodes" JSONB;

-- ─── sub_orders ─────────────────────────────────────────────────────
ALTER TABLE "sub_orders"
  ADD COLUMN "delivery_method" "DeliveryMethod",
  ADD COLUMN "ithink_awb" TEXT,
  ADD COLUMN "ithink_logistic" TEXT,
  ADD COLUMN "ithink_tracking_url" TEXT,
  ADD COLUMN "ithink_order_refnum" TEXT,
  ADD COLUMN "ithink_booked_at" TIMESTAMP(3),
  ADD COLUMN "self_delivery_status" "SelfDeliveryStatus",
  ADD COLUMN "self_delivered_at" TIMESTAMP(3),
  ADD COLUMN "self_delivery_notes" TEXT,
  ADD COLUMN "pickup_address_id_snapshot" TEXT;

-- Indexes for the new SubOrder query paths.
CREATE INDEX "sub_orders_delivery_method_idx" ON "sub_orders" ("delivery_method");
CREATE INDEX "sub_orders_ithink_awb_idx" ON "sub_orders" ("ithink_awb");
CREATE INDEX "sub_orders_self_delivery_status_idx"
  ON "sub_orders" ("self_delivery_status");
