-- Phase 37 (2026-05-21) — Collection audit log + Cloudinary publicId
-- tracking + alt-text + soft-delete + sort-order on the join table +
-- query-pattern indexes.
--
-- Mirrors the Phase 34 (category) + Phase 35 (brand) audit-log
-- pattern: every mutation writes a row; the JSON snapshots make
-- post-mortem investigation a single indexed query.
--
-- Soft-delete: pre-Phase-37 a hard-delete cascaded to all map rows
-- + 404'd the storefront. The deletedAt column + WHERE deletedAt
-- IS NULL filter on the public path means a mistake is reversible.
--
-- Join-table sortOrder: marketers can now place the bestseller
-- first inside a collection landing page; pre-Phase-37 ordering
-- was attach-time only.

ALTER TABLE "product_collections"
  ADD COLUMN "image_public_id" TEXT,
  ADD COLUMN "image_alt_text" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "product_collections_is_active_idx" ON "product_collections" ("is_active");
CREATE INDEX "product_collections_deleted_at_idx" ON "product_collections" ("deleted_at");

ALTER TABLE "product_collection_maps"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "product_collection_maps_collection_id_sort_order_idx"
  ON "product_collection_maps" ("collection_id", "sort_order");

CREATE TYPE "CollectionAuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'IMAGE_CHANGE',
  'ATTACH',
  'DETACH',
  'REORDER'
);

CREATE TABLE "collection_audit_logs" (
  "id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "action" "CollectionAuditAction" NOT NULL,
  "admin_id" TEXT,
  "previous_state" JSONB,
  "new_state" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "collection_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "collection_audit_logs_collection_id_created_at_idx"
  ON "collection_audit_logs" ("collection_id", "created_at");

CREATE INDEX "collection_audit_logs_admin_id_created_at_idx"
  ON "collection_audit_logs" ("admin_id", "created_at");

ALTER TABLE "collection_audit_logs"
  ADD CONSTRAINT "collection_audit_logs_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
