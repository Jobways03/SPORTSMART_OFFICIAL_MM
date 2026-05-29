-- Phase 85 (2026-05-23) — manual AWB attachment audit Gaps #11, #13.
--
-- 1. AwbAttachmentSource enum + audit columns on sub_orders so the
--    SHIPPED row records who/when/how the AWB was attached.
-- 2. sub_order_awb_history child table preserves every AWB
--    assignment including overwrites (partial unique index keeps at
--    most one row per sub-order with detached_at = NULL).
-- 3. Backfill awbAttachmentSource for legacy rows that already
--    have trackingNumber: assume SELLER_MANUAL (the only writer
--    other than admin/iThink booking).

CREATE TYPE "AwbAttachmentSource" AS ENUM (
  'SELLER_MANUAL',
  'FRANCHISE_MANUAL',
  'ADMIN_OVERRIDE',
  'ITHINK_BOOKING',
  'SHIPROCKET_BOOKING'
);

-- ── 1. SubOrder audit columns ─────────────────────────────────
ALTER TABLE "sub_orders"
  ADD COLUMN "awb_attached_at"          TIMESTAMP(3),
  ADD COLUMN "awb_attached_by"          TEXT,
  ADD COLUMN "awb_attachment_source"    "AwbAttachmentSource";

-- Backfill: legacy rows with a tracking_number get SELLER_MANUAL +
-- shipped_at as the best proxy for when the AWB landed. iThink-
-- booked rows are detectable via ithink_awb being set.
UPDATE "sub_orders"
SET "awb_attached_at"       = COALESCE("shipped_at", "updated_at"),
    "awb_attachment_source" = CASE
      WHEN "ithink_awb" IS NOT NULL THEN 'ITHINK_BOOKING'::"AwbAttachmentSource"
      WHEN "fulfillment_node_type" = 'FRANCHISE' THEN 'FRANCHISE_MANUAL'::"AwbAttachmentSource"
      ELSE 'SELLER_MANUAL'::"AwbAttachmentSource"
    END
WHERE "tracking_number" IS NOT NULL AND "awb_attached_at" IS NULL;

-- ── 2. AWB history child table ────────────────────────────────
CREATE TABLE "sub_order_awb_history" (
  "id"                TEXT                  PRIMARY KEY,
  "sub_order_id"      TEXT                  NOT NULL,
  "awb_number"        TEXT                  NOT NULL,
  "courier_name"      TEXT                  NOT NULL,
  "tracking_url"      TEXT,
  "attachment_source" "AwbAttachmentSource" NOT NULL,
  "attached_by"       TEXT,
  "reason"            TEXT,
  "attached_at"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detached_at"       TIMESTAMP(3),

  CONSTRAINT "sub_order_awb_history_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE
);

CREATE INDEX "sub_order_awb_history_sub_order_id_attached_at_idx"
  ON "sub_order_awb_history" ("sub_order_id", "attached_at" DESC);
CREATE INDEX "sub_order_awb_history_awb_number_idx"
  ON "sub_order_awb_history" ("awb_number");
-- Partial unique: at most one active (detached_at NULL) row per sub-order.
CREATE UNIQUE INDEX "sub_order_awb_history_sub_order_active_unique"
  ON "sub_order_awb_history" ("sub_order_id")
  WHERE "detached_at" IS NULL;

-- ── 3. Backfill: one history row per existing AWB ─────────────
INSERT INTO "sub_order_awb_history"
  (id, sub_order_id, awb_number, courier_name, tracking_url,
   attachment_source, attached_by, attached_at, detached_at)
SELECT
  gen_random_uuid()::text,
  id,
  "tracking_number",
  COALESCE("courier_name", 'UNKNOWN'),
  "tracking_url",
  "awb_attachment_source",
  "awb_attached_by",
  "awb_attached_at",
  NULL
FROM "sub_orders"
WHERE "tracking_number" IS NOT NULL AND "awb_attachment_source" IS NOT NULL;
