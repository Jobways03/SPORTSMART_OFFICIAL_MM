-- Phase 80 (2026-05-22) — sub-order acceptance audit Gaps #7/#18/#19.
--
-- 1. New SubOrderRejectionType enum + column to discriminate manual
--    rejects from cron-fired auto-rejects (Gap #19).
-- 2. acceptance + rejection actor/timestamp columns so the audit
--    chain has "who clicked Accept" and "when did the cron fire"
--    (Gap #7).
-- 3. (accept_status, fulfillment_node_type, accept_deadline_at)
--    index so the unified SLA cron's filter is index-served (Gap #18).
-- 4. Backfill existing ACCEPTED rows' accepted_at from updated_at and
--    REJECTED rows' rejected_at + rejection_type=MANUAL.

-- ── 1. Rejection-type enum + column ────────────────────────────
CREATE TYPE "SubOrderRejectionType" AS ENUM (
  'MANUAL',
  'AUTO_SLA',
  'ADMIN_FORCE'
);

ALTER TABLE "sub_orders"
  ADD COLUMN "accepted_at"      TIMESTAMP(3),
  ADD COLUMN "accepted_by"      TEXT,
  ADD COLUMN "rejected_at"      TIMESTAMP(3),
  ADD COLUMN "rejected_by"      TEXT,
  ADD COLUMN "rejection_type"   "SubOrderRejectionType",
  ADD COLUMN "auto_rejected_at" TIMESTAMP(3);

-- Backfill — best-effort heuristic, using updated_at as the closest
-- proxy for the actual transition timestamp on legacy rows.
UPDATE "sub_orders"
SET "accepted_at" = "updated_at"
WHERE "accept_status" = 'ACCEPTED' AND "accepted_at" IS NULL;

UPDATE "sub_orders"
SET "rejected_at" = "updated_at",
    "rejection_type" = 'MANUAL'::"SubOrderRejectionType"
WHERE "accept_status" = 'REJECTED' AND "rejected_at" IS NULL;

-- ── 2. Indexes ─────────────────────────────────────────────────
CREATE INDEX "sub_orders_accept_status_fulfillment_node_type_accept_deadl_idx"
  ON "sub_orders" ("accept_status", "fulfillment_node_type", "accept_deadline_at");

CREATE INDEX "sub_orders_rejection_type_auto_rejected_at_idx"
  ON "sub_orders" ("rejection_type", "auto_rejected_at");
