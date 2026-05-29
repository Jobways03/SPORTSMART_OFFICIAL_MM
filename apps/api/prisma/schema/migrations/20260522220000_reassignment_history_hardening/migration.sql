-- Phase 79 (2026-05-22) — reassignment-history audit Gaps #6/#8/#13/#20.
--
-- 1. New enum + column `event_type` on order_reassignment_logs so
--    admin overrides, T5 seller-reject cascades, and franchise-reject
--    cascades are queryable separately (Gap #6).
-- 2. FK relations: master_order_id → master_orders (Cascade), sub_order_id
--    → sub_orders (Cascade), new_sub_order_id → sub_orders (SetNull)
--    so orphan rows from manual DB ops are impossible (Gap #8/#13).
-- 3. New (master_order_id, created_at DESC, id) composite index so the
--    per-order paginated read can use a single deterministic order
--    (Gap #20). Plus an (event_type, created_at) index for the
--    audit-dashboard "all admin overrides in the last 7 days" query.

-- ── 1. eventType enum + column ─────────────────────────────────
CREATE TYPE "OrderReassignmentEventType" AS ENUM (
  'ADMIN_MANUAL_OVERRIDE',
  'AUTO_AFTER_SELLER_REJECT',
  'AUTO_AFTER_FRANCHISE_REJECT',
  'AUTO_AFTER_EXCEPTION_REMEDIATE'
);

ALTER TABLE "order_reassignment_logs"
  ADD COLUMN "event_type" "OrderReassignmentEventType"
    NOT NULL DEFAULT 'ADMIN_MANUAL_OVERRIDE';

-- Heuristic backfill — every legacy row currently in the table was
-- written by the seller-reject auto-cascade path or the modern admin
-- manual path (the legacy admin-control-tower path was deleted in
-- Phase 78). The reason text discriminates them well enough for
-- forensics.
UPDATE "order_reassignment_logs"
SET "event_type" = CASE
  WHEN reason ILIKE 'Franchise rejected%'      THEN 'AUTO_AFTER_FRANCHISE_REJECT'::"OrderReassignmentEventType"
  WHEN reason ILIKE 'Seller rejected%'         THEN 'AUTO_AFTER_SELLER_REJECT'::"OrderReassignmentEventType"
  WHEN reason ILIKE '%auto-reassign%'          THEN 'AUTO_AFTER_SELLER_REJECT'::"OrderReassignmentEventType"
  ELSE 'ADMIN_MANUAL_OVERRIDE'::"OrderReassignmentEventType"
END
WHERE TRUE;

-- ── 2. FK constraints ──────────────────────────────────────────
ALTER TABLE "order_reassignment_logs"
  ADD CONSTRAINT "order_reassignment_logs_master_order_id_fkey"
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
  ON DELETE CASCADE;

ALTER TABLE "order_reassignment_logs"
  ADD CONSTRAINT "order_reassignment_logs_sub_order_id_fkey"
  FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id")
  ON DELETE CASCADE;

ALTER TABLE "order_reassignment_logs"
  ADD CONSTRAINT "order_reassignment_logs_new_sub_order_id_fkey"
  FOREIGN KEY ("new_sub_order_id") REFERENCES "sub_orders"("id")
  ON DELETE SET NULL;

-- ── 3. Indexes ─────────────────────────────────────────────────
CREATE INDEX "order_reassignment_logs_master_created_id_idx"
  ON "order_reassignment_logs" ("master_order_id", "created_at" DESC, "id");
CREATE INDEX "order_reassignment_logs_event_type_created_at_idx"
  ON "order_reassignment_logs" ("event_type", "created_at");
