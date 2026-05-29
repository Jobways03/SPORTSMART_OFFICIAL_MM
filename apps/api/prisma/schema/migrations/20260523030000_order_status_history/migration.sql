-- Phase 84 (2026-05-23) — order timeline / status history audit Gaps #1, #6-#9, #17.
--
-- 1. OrderTimelineEventType + TimelineActorType + TimelineVisibility enums.
-- 2. order_status_history table + indexes + FKs to master/sub-orders.
-- 3. Append-only trigger: blocks UPDATE/DELETE on history rows
--    (Gap #17). Super-admins with raw SQL can still drop the
--    trigger and rewrite history, but the trigger forces them to do
--    it explicitly and leave a paper trail (DDL audit).
-- 4. Backfill from current denormalized timestamps so the new
--    customer/admin endpoints have data for existing orders without
--    a code-side fallback path.

-- ── 1. Enums ────────────────────────────────────────────────────
CREATE TYPE "OrderTimelineEventType" AS ENUM (
  -- Master-order lifecycle
  'ORDER_PLACED',
  'ORDER_PAYMENT_CAPTURED',
  'ORDER_VERIFICATION_CLAIMED',
  'ORDER_VERIFICATION_RELEASED',
  'ORDER_VERIFICATION_AUTO_EXPIRED',
  'ORDER_VERIFIED',
  'ORDER_REJECTED',
  'ORDER_ROUTED_TO_SELLER',
  'ORDER_EXCEPTION_QUEUE',
  'ORDER_PARTIALLY_SHIPPED',
  'ORDER_PARTIALLY_DELIVERED',
  'ORDER_PARTIALLY_CANCELLED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  -- Sub-order lifecycle
  'SUBORDER_ASSIGNED',
  'SUBORDER_ACCEPTED',
  'SUBORDER_REJECTED_MANUAL',
  'SUBORDER_REJECTED_AUTO_SLA',
  'SUBORDER_REASSIGNED',
  'SUBORDER_PACKED',
  'SUBORDER_SHIPPED',
  'SUBORDER_OUT_FOR_DELIVERY',
  'SUBORDER_DELIVERED_WEBHOOK',
  'SUBORDER_DELIVERED_MANUAL',
  'SUBORDER_NDR_ATTEMPT',
  'SUBORDER_CANCELLED_BY_ADMIN',
  -- Payment / Refund
  'PAYMENT_INTENT_CREATED',
  'PAYMENT_CAPTURED',
  'PAYMENT_FAILED',
  'REFUND_INITIATED',
  'REFUND_COMPLETED',
  'REFUND_FAILED',
  -- Commission / Settlement
  'COMMISSION_LOCKED',
  'COMMISSION_PAID',
  'COMMISSION_REVERSED'
);

CREATE TYPE "TimelineActorType" AS ENUM (
  'SYSTEM', 'ADMIN', 'SELLER', 'FRANCHISE', 'CUSTOMER', 'CARRIER'
);

CREATE TYPE "TimelineVisibility" AS ENUM (
  'ADMIN_ONLY', 'CUSTOMER_VISIBLE', 'SELLER_VISIBLE', 'FRANCHISE_VISIBLE'
);

-- ── 2. Table + indexes ──────────────────────────────────────────
CREATE TABLE "order_status_history" (
  "id"              TEXT                       PRIMARY KEY,
  "master_order_id" TEXT                       NOT NULL,
  "sub_order_id"    TEXT,
  "event_type"      "OrderTimelineEventType"   NOT NULL,
  "old_status"      TEXT,
  "new_status"      TEXT,
  "actor_type"      "TimelineActorType"        NOT NULL,
  "actor_id"        TEXT,
  "actor_name"      TEXT,
  "visibility"      "TimelineVisibility"       NOT NULL DEFAULT 'ADMIN_ONLY',
  "note"            TEXT,
  "reason"          TEXT,
  "metadata"        JSONB,
  "idempotency_key" TEXT,
  "created_at"      TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_status_history_master_order_id_fkey"
    FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE,
  CONSTRAINT "order_status_history_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE
);

CREATE INDEX "order_status_history_master_order_id_created_at_id_idx"
  ON "order_status_history" ("master_order_id", "created_at", "id");
CREATE INDEX "order_status_history_sub_order_id_created_at_idx"
  ON "order_status_history" ("sub_order_id", "created_at");
CREATE INDEX "order_status_history_event_type_created_at_idx"
  ON "order_status_history" ("event_type", "created_at");
CREATE INDEX "order_status_history_actor_id_created_at_idx"
  ON "order_status_history" ("actor_id", "created_at");
CREATE INDEX "order_status_history_master_order_id_visibility_created_at_idx"
  ON "order_status_history" ("master_order_id", "visibility", "created_at");
CREATE UNIQUE INDEX "order_status_history_idempotency_key_unique"
  ON "order_status_history" ("idempotency_key");

-- ── 3. Immutability trigger (Gap #17) ───────────────────────────
-- Blocks UPDATE/DELETE at the row level. Super-admins can DROP the
-- trigger to override, but DDL is auditable in pg_event_trigger /
-- the platform's deploy logs — a far higher bar than a quiet
-- DML edit.
CREATE OR REPLACE FUNCTION order_status_history_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'order_status_history is append-only (Phase 84 immutability)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_status_history_no_update
  BEFORE UPDATE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION order_status_history_block_mutation();

CREATE TRIGGER order_status_history_no_delete
  BEFORE DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION order_status_history_block_mutation();

-- ── 4. Backfill from denormalized timestamps ────────────────────
-- Master-level events.
INSERT INTO "order_status_history"
  (id, master_order_id, event_type, new_status, actor_type, visibility, created_at)
SELECT
  gen_random_uuid()::text,
  id,
  'ORDER_PLACED',
  'PLACED',
  'CUSTOMER',
  'CUSTOMER_VISIBLE',
  created_at
FROM "master_orders";

INSERT INTO "order_status_history"
  (id, master_order_id, event_type, new_status, actor_type, actor_id, visibility, created_at)
SELECT
  gen_random_uuid()::text,
  id,
  'ORDER_VERIFIED',
  'VERIFIED',
  'ADMIN',
  verified_by,
  'CUSTOMER_VISIBLE',
  verified_at
FROM "master_orders"
WHERE verified_at IS NOT NULL;

-- Sub-order lifecycle events from existing columns.
INSERT INTO "order_status_history"
  (id, master_order_id, sub_order_id, event_type, new_status, actor_type, actor_id, visibility, created_at)
SELECT
  gen_random_uuid()::text,
  master_order_id,
  id,
  'SUBORDER_ACCEPTED',
  'ACCEPTED',
  'SELLER',
  accepted_by,
  'CUSTOMER_VISIBLE',
  accepted_at
FROM "sub_orders"
WHERE accepted_at IS NOT NULL;

INSERT INTO "order_status_history"
  (id, master_order_id, sub_order_id, event_type, new_status, actor_type, actor_id, visibility, created_at)
SELECT
  gen_random_uuid()::text,
  master_order_id,
  id,
  'SUBORDER_PACKED',
  'PACKED',
  'SELLER',
  packed_by,
  'CUSTOMER_VISIBLE',
  packed_at
FROM "sub_orders"
WHERE packed_at IS NOT NULL;

INSERT INTO "order_status_history"
  (id, master_order_id, sub_order_id, event_type, new_status, actor_type, actor_id, visibility, created_at)
SELECT
  gen_random_uuid()::text,
  master_order_id,
  id,
  'SUBORDER_SHIPPED',
  'SHIPPED',
  'SELLER',
  shipped_by,
  'CUSTOMER_VISIBLE',
  shipped_at
FROM "sub_orders"
WHERE shipped_at IS NOT NULL;

INSERT INTO "order_status_history"
  (id, master_order_id, sub_order_id, event_type, new_status, actor_type, actor_id, visibility, created_at)
SELECT
  gen_random_uuid()::text,
  master_order_id,
  id,
  CASE
    WHEN delivery_source = 'WEBHOOK_SHIPROCKET' THEN 'SUBORDER_DELIVERED_WEBHOOK'::"OrderTimelineEventType"
    WHEN delivery_source = 'WEBHOOK_ITHINK'     THEN 'SUBORDER_DELIVERED_WEBHOOK'::"OrderTimelineEventType"
    ELSE 'SUBORDER_DELIVERED_MANUAL'::"OrderTimelineEventType"
  END,
  'DELIVERED',
  CASE
    WHEN delivery_source::text LIKE 'WEBHOOK_%' THEN 'CARRIER'::"TimelineActorType"
    WHEN delivery_source = 'MANUAL_FRANCHISE' THEN 'FRANCHISE'::"TimelineActorType"
    ELSE 'ADMIN'::"TimelineActorType"
  END,
  delivered_by,
  'CUSTOMER_VISIBLE',
  delivered_at
FROM "sub_orders"
WHERE delivered_at IS NOT NULL;

INSERT INTO "order_status_history"
  (id, master_order_id, sub_order_id, event_type, new_status, actor_type, actor_id, visibility, reason, created_at)
SELECT
  gen_random_uuid()::text,
  master_order_id,
  id,
  CASE
    WHEN rejection_type = 'AUTO_SLA' THEN 'SUBORDER_REJECTED_AUTO_SLA'::"OrderTimelineEventType"
    ELSE 'SUBORDER_REJECTED_MANUAL'::"OrderTimelineEventType"
  END,
  'REJECTED',
  CASE
    WHEN rejection_type = 'AUTO_SLA' THEN 'SYSTEM'::"TimelineActorType"
    ELSE 'SELLER'::"TimelineActorType"
  END,
  rejected_by,
  'CUSTOMER_VISIBLE',
  rejection_reason,
  rejected_at
FROM "sub_orders"
WHERE rejected_at IS NOT NULL;

INSERT INTO "order_status_history"
  (id, master_order_id, sub_order_id, event_type, new_status, actor_type, actor_id, visibility, reason, created_at)
SELECT
  gen_random_uuid()::text,
  master_order_id,
  id,
  'SUBORDER_CANCELLED_BY_ADMIN',
  'CANCELLED',
  CASE
    WHEN cancellation_source = 'CUSTOMER' THEN 'CUSTOMER'::"TimelineActorType"
    WHEN cancellation_source = 'SYSTEM'   THEN 'SYSTEM'::"TimelineActorType"
    ELSE 'ADMIN'::"TimelineActorType"
  END,
  cancelled_by,
  'CUSTOMER_VISIBLE',
  cancel_reason,
  cancelled_at
FROM "sub_orders"
WHERE cancelled_at IS NOT NULL;
