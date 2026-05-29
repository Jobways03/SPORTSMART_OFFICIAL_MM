-- Phase 39 (2026-05-21) — Metafield definition audit trail + FK
-- restrict to prevent silent value-cascade destruction + query-pattern
-- indexes for the required-check path.
--
-- The FK switch from CASCADE → RESTRICT is the most consequential
-- change: pre-Phase-39 a single "DELETE FROM metafield_definitions
-- WHERE id = …" silently cascade-deleted every ProductMetafield row
-- pointing at that definition. With 1,285 definitions × N products
-- the blast radius was unbounded. The controller already routes
-- through deactivate when product values exist, so the new
-- constraint just hardens the contract at the DB layer.

ALTER TABLE "product_metafields"
  DROP CONSTRAINT "product_metafields_metafield_definition_id_fkey";

ALTER TABLE "product_metafields"
  ADD CONSTRAINT "product_metafields_metafield_definition_id_fkey"
  FOREIGN KEY ("metafield_definition_id")
  REFERENCES "metafield_definitions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Query-pattern indexes for the required-on-submit check + active
-- definition listing.
CREATE INDEX "metafield_definitions_is_required_category_id_idx"
  ON "metafield_definitions" ("is_required", "category_id");

CREATE INDEX "metafield_definitions_is_active_idx"
  ON "metafield_definitions" ("is_active");

-- Audit log table.
CREATE TYPE "MetafieldDefinitionAuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'DEACTIVATE',
  'REACTIVATE',
  'BULK_ASSIGN'
);

CREATE TABLE "metafield_definition_audit_logs" (
  "id" TEXT NOT NULL,
  "metafield_definition_id" TEXT NOT NULL,
  "action" "MetafieldDefinitionAuditAction" NOT NULL,
  "admin_id" TEXT,
  "previous_state" JSONB,
  "new_state" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "metafield_definition_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "metafield_definition_audit_logs_metafield_definition_id_created_at_idx"
  ON "metafield_definition_audit_logs" ("metafield_definition_id", "created_at");

CREATE INDEX "metafield_definition_audit_logs_admin_id_created_at_idx"
  ON "metafield_definition_audit_logs" ("admin_id", "created_at");

ALTER TABLE "metafield_definition_audit_logs"
  ADD CONSTRAINT "metafield_definition_audit_logs_metafield_definition_id_fkey"
  FOREIGN KEY ("metafield_definition_id") REFERENCES "metafield_definitions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
