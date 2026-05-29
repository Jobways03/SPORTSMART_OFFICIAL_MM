-- Phase 47 (2026-05-21) — Storefront content blocks v2.
--
-- Adds:
--   1. StorefrontContentBlock.image_public_id  — Cloudinary asset ref
--      for cleanup on replace/reset/delete (Gap #2).
--   2. StorefrontContentBlock.image_alt        — WCAG 1.1.1 alt text.
--   3. StorefrontContentBlock.start_at / end_at — campaign schedule
--      window read by the public listActiveAsMap (Gap #6).
--   4. StorefrontContentBlock.deleted_at       — soft-delete recovery
--      (Gap #15).
--   5. StorefrontSlotDefinition.deleted_at     — same.
--   6. content_audit_logs table                — audit trail (Gap #11).
--
-- Composite index on (active, start_at, end_at) covers the public
-- read filter so the schedule check is index-only.

ALTER TABLE "storefront_content_blocks"
  ADD COLUMN "image_public_id" TEXT,
  ADD COLUMN "image_alt"       TEXT,
  ADD COLUMN "start_at"        TIMESTAMP(3),
  ADD COLUMN "end_at"          TIMESTAMP(3),
  ADD COLUMN "deleted_at"      TIMESTAMP(3);

CREATE INDEX "storefront_content_blocks_active_start_at_end_at_idx"
  ON "storefront_content_blocks" ("active", "start_at", "end_at");

ALTER TABLE "storefront_slot_definitions"
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE TABLE "content_audit_logs" (
  "id" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id"   TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "prev_state"    JSONB,
  "new_state"     JSONB,
  "actor_id"      TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "content_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_audit_logs_resource_type_resource_id_created_at_idx"
  ON "content_audit_logs" ("resource_type", "resource_id", "created_at");

CREATE INDEX "content_audit_logs_actor_id_created_at_idx"
  ON "content_audit_logs" ("actor_id", "created_at");
