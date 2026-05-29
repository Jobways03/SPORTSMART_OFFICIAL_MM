-- Phase 159k (2026-05-27) — Remove the iThink Logistics integration.
--
-- Self-delivery is now the only DeliveryMethod; the courier-agnostic
-- shipping skeleton (port, AWB-attach, tracking-ingest, NDR/RTO) stays
-- for a future carrier. This migration drops every iThink-specific
-- column, the IThinkWarehouseApprovalStatus enum, and the iThink enum
-- values from DeliveryMethod / DeliveryConfirmationSource /
-- AwbAttachmentSource.
--
-- Verified before writing: 0 rows reference ITHINK_LOGISTICS,
-- WEBHOOK_ITHINK, or ITHINK_BOOKING. The guarded UPDATEs below null out
-- any such rows defensively (all three columns are nullable) so the
-- type-recreation casts can't fail on a stray value.

-- 1. Drop iThink columns from sellers + franchise_partners. These used
--    the IThinkWarehouseApprovalStatus enum, so they must go before the
--    type is dropped (step 3).
ALTER TABLE "sellers"
  DROP COLUMN IF EXISTS "ithink_enabled",
  DROP COLUMN IF EXISTS "ithink_pickup_address_id",
  DROP COLUMN IF EXISTS "ithink_warehouse_status",
  DROP COLUMN IF EXISTS "ithink_registered_at",
  DROP COLUMN IF EXISTS "ithink_registered_address_hash";

ALTER TABLE "franchise_partners"
  DROP COLUMN IF EXISTS "ithink_enabled",
  DROP COLUMN IF EXISTS "ithink_pickup_address_id",
  DROP COLUMN IF EXISTS "ithink_warehouse_status",
  DROP COLUMN IF EXISTS "ithink_registered_at",
  DROP COLUMN IF EXISTS "ithink_registered_address_hash";

-- 2. Drop iThink-specific columns + index from sub_orders. (Dropping
--    ithink_awb also auto-drops its index; the explicit DROP INDEX is
--    belt-and-suspenders.)
DROP INDEX IF EXISTS "sub_orders_ithink_awb_idx";
ALTER TABLE "sub_orders"
  DROP COLUMN IF EXISTS "ithink_awb",
  DROP COLUMN IF EXISTS "ithink_logistic",
  DROP COLUMN IF EXISTS "ithink_tracking_url",
  DROP COLUMN IF EXISTS "ithink_order_refnum",
  DROP COLUMN IF EXISTS "ithink_booked_at";

-- 3. Drop the now-unreferenced IThinkWarehouseApprovalStatus enum.
DROP TYPE IF EXISTS "IThinkWarehouseApprovalStatus";

-- 4. Remove ITHINK_LOGISTICS from DeliveryMethod. Postgres can't DROP
--    VALUE, so recreate the type after nulling any rows that used it.
UPDATE "sub_orders" SET "delivery_method" = NULL WHERE "delivery_method" = 'ITHINK_LOGISTICS';
ALTER TYPE "DeliveryMethod" RENAME TO "DeliveryMethod_old";
CREATE TYPE "DeliveryMethod" AS ENUM ('SELF_DELIVERY');
ALTER TABLE "sub_orders"
  ALTER COLUMN "delivery_method" TYPE "DeliveryMethod"
  USING ("delivery_method"::text::"DeliveryMethod");
DROP TYPE "DeliveryMethod_old";

-- 5. Remove WEBHOOK_ITHINK from DeliveryConfirmationSource.
UPDATE "sub_orders" SET "delivery_source" = NULL WHERE "delivery_source" = 'WEBHOOK_ITHINK';
ALTER TYPE "DeliveryConfirmationSource" RENAME TO "DeliveryConfirmationSource_old";
CREATE TYPE "DeliveryConfirmationSource" AS ENUM ('WEBHOOK_SHIPROCKET', 'MANUAL_ADMIN', 'MANUAL_FRANCHISE');
ALTER TABLE "sub_orders"
  ALTER COLUMN "delivery_source" TYPE "DeliveryConfirmationSource"
  USING ("delivery_source"::text::"DeliveryConfirmationSource");
DROP TYPE "DeliveryConfirmationSource_old";

-- 6. Remove ITHINK_BOOKING from AwbAttachmentSource. Two columns use it:
--    sub_orders.awb_attachment_source (nullable) and
--    sub_order_awb_history.attachment_source (NOT NULL — 0 rows use the
--    dropped value so the cast is safe).
UPDATE "sub_orders" SET "awb_attachment_source" = NULL WHERE "awb_attachment_source" = 'ITHINK_BOOKING';
ALTER TYPE "AwbAttachmentSource" RENAME TO "AwbAttachmentSource_old";
CREATE TYPE "AwbAttachmentSource" AS ENUM ('SELLER_MANUAL', 'FRANCHISE_MANUAL', 'ADMIN_OVERRIDE', 'SHIPROCKET_BOOKING');
ALTER TABLE "sub_orders"
  ALTER COLUMN "awb_attachment_source" TYPE "AwbAttachmentSource"
  USING ("awb_attachment_source"::text::"AwbAttachmentSource");
ALTER TABLE "sub_order_awb_history"
  ALTER COLUMN "attachment_source" TYPE "AwbAttachmentSource"
  USING ("attachment_source"::text::"AwbAttachmentSource");
DROP TYPE "AwbAttachmentSource_old";
