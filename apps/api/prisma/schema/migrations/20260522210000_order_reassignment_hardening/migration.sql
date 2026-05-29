-- Phase 78 (2026-05-22) — reassignment audit Gaps #5, #8, #14, #16, #22.
--
-- 1. OrderReassignmentLog gains:
--    - from_node_type / to_node_type discriminators (Gap #8/#22)
--    - from_node_id / to_node_id polymorphic ids alongside the
--      legacy from_seller_id / to_seller_id (Gap #8/#22)
--    - reassigned_by FK to admins (Gap #5)
--    - failure_reason for the unsuccessful auto-reassign path (Gap #14)
--    - reassignment_sequence counter for multi-bounce visibility (Gap #16)
--    - indexes for the new "by admin / by node" queries
--
-- 2. SubOrder gains reassignment_count + last_reassigned_at (Gap #16).
--
-- Backfill strategy: existing rows keep their (from_seller_id, to_seller_id)
-- columns; defaults of 'SELLER' on the new nodeType columns are correct for
-- the existing data which is uniformly seller-only.

-- ── 1. OrderReassignmentLog new columns ─────────────────────────
ALTER TABLE "order_reassignment_logs"
  ADD COLUMN "from_node_type"          TEXT     NOT NULL DEFAULT 'SELLER',
  ADD COLUMN "to_node_type"            TEXT     NOT NULL DEFAULT 'SELLER',
  ADD COLUMN "from_node_id"            TEXT,
  ADD COLUMN "to_node_id"              TEXT,
  ADD COLUMN "failure_reason"          TEXT,
  ADD COLUMN "reassigned_by"           TEXT,
  ADD COLUMN "reassignment_sequence"   INTEGER  NOT NULL DEFAULT 1;

-- Backfill the new polymorphic id columns from the legacy seller-id slots
-- so every historical row has fromNodeId/toNodeId populated.
UPDATE "order_reassignment_logs"
SET "from_node_id" = NULLIF("from_seller_id", ''),
    "to_node_id"   = "to_seller_id";

-- FK to admins; ON DELETE SET NULL preserves the log if the admin row
-- is later removed. Skip the constraint check on existing rows since
-- reassigned_by starts NULL on backfill.
ALTER TABLE "order_reassignment_logs"
  ADD CONSTRAINT "order_reassignment_logs_reassigned_by_fkey"
  FOREIGN KEY ("reassigned_by") REFERENCES "admins"("id")
  ON DELETE SET NULL;

CREATE INDEX "order_reassignment_logs_reassigned_by_created_at_idx"
  ON "order_reassignment_logs" ("reassigned_by", "created_at");
CREATE INDEX "order_reassignment_logs_from_node_id_from_node_type_idx"
  ON "order_reassignment_logs" ("from_node_id", "from_node_type");
CREATE INDEX "order_reassignment_logs_to_node_id_to_node_type_idx"
  ON "order_reassignment_logs" ("to_node_id", "to_node_type");

-- ── 2. SubOrder reassignment counters ───────────────────────────
ALTER TABLE "sub_orders"
  ADD COLUMN "reassignment_count"   INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN "last_reassigned_at"   TIMESTAMP(3);
