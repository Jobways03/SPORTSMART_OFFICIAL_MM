-- Phase 159n (2026-05-27) — Franchise catalog-mapping lifecycle hardening:
-- admin-decision actor/reason attribution, OCC version, decision-history
-- table, and two missing indexes.

ALTER TABLE "franchise_catalog_mappings"
  ADD COLUMN IF NOT EXISTS "approved_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "stopped_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stopped_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stop_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "removed_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "removed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "franchise_catalog_mappings_franchise_id_approval_status_idx"
  ON "franchise_catalog_mappings" ("franchise_id", "approval_status");
CREATE INDEX IF NOT EXISTS "franchise_catalog_mappings_variant_id_idx"
  ON "franchise_catalog_mappings" ("variant_id");

CREATE TABLE IF NOT EXISTS "franchise_catalog_mapping_events" (
  "id" TEXT NOT NULL,
  "mapping_id" TEXT,
  "franchise_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_id" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "actor_id" TEXT,
  "actor_role" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_catalog_mapping_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_catalog_mapping_events_franchise_id_created_at_idx"
  ON "franchise_catalog_mapping_events" ("franchise_id", "created_at");
CREATE INDEX IF NOT EXISTS "franchise_catalog_mapping_events_mapping_id_idx"
  ON "franchise_catalog_mapping_events" ("mapping_id");
ALTER TABLE "franchise_catalog_mapping_events"
  ADD CONSTRAINT "franchise_catalog_mapping_events_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
