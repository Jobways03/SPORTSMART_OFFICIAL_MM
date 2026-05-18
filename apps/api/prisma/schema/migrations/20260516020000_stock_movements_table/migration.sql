-- Phase 4 follow-up (2026-05-16) — Dedicated StockMovement audit
-- ledger for inventory state changes.
--
-- Pre-2026-05-16 the StockMovementLedgerService wrote into the
-- generic AuditLog table. That worked for compliance (the tamper-
-- evident chain proved the movements happened) but was slow for
-- ad-hoc queries — "show me every change to mapping X" needed a
-- full audit-log scan. This table gives the inventory drill-down +
-- analytics a properly-indexed home.
--
-- During the soak window the ledger service writes BOTH this table
-- AND the audit-log row; once query-pattern confidence is high,
-- the audit-log path can drop.

CREATE TYPE "StockMovementKind" AS ENUM (
  'RESERVED',
  'RELEASED',
  'CONFIRMED',
  'DEDUCTED',
  'RESTOCKED',
  'WRITE_OFF',
  'MANUAL_ADJUST',
  'INITIAL'
);

CREATE TABLE "stock_movements" (
  "id"                    TEXT NOT NULL,
  "mapping_id"            TEXT NOT NULL,
  "kind"                  "StockMovementKind" NOT NULL,
  "quantity_delta"        INTEGER NOT NULL,
  "before_stock_qty"      INTEGER NOT NULL,
  "after_stock_qty"       INTEGER NOT NULL,
  "before_reserved_qty"   INTEGER,
  "after_reserved_qty"    INTEGER,
  "reason"                TEXT NOT NULL,
  "reference_type"        TEXT,
  "reference_id"          TEXT,
  "actor_id"              TEXT,
  "actor_role"            TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- Hot-path indexes. The descending createdAt is the dominant access
-- pattern: "give me the most recent N movements for mapping X".
CREATE INDEX "stock_movements_mapping_id_created_at_idx"
  ON "stock_movements" ("mapping_id", "created_at" DESC);

CREATE INDEX "stock_movements_reference_type_reference_id_idx"
  ON "stock_movements" ("reference_type", "reference_id");

CREATE INDEX "stock_movements_created_at_idx"
  ON "stock_movements" ("created_at");

-- FK onto seller_product_mappings(id). onDelete: CASCADE — if the
-- mapping is hard-deleted (rare; soft-delete is the standard path)
-- the movements go with it.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_mapping_id_fkey"
  FOREIGN KEY ("mapping_id")
  REFERENCES "seller_product_mappings"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
