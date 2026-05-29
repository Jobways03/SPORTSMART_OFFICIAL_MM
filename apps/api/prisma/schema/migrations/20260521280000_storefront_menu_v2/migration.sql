-- Phase 48 (2026-05-21) — storefront menus hardening.
--
-- Adds:
--   - isActive + deletedAt + audit FKs on storefront_menus
--   - isActive + deletedAt + displayLabel + open_in_new_tab + rel_nofollow
--     on storefront_menu_items
--   - composite index (menu_id, is_active, parent_id, position) for the
--     public tree query
--   - menu_audit_logs table for marketing/compliance traceability
--
-- All ADD COLUMN defaults are NOT NULL with safe defaults so the
-- migration is backfill-safe.

ALTER TABLE "storefront_menus"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "updated_by_id" TEXT;

ALTER TABLE "storefront_menu_items"
  ADD COLUMN "display_label" TEXT,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "open_in_new_tab" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "rel_nofollow" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "storefront_menu_items_menu_id_is_active_parent_id_position_idx"
  ON "storefront_menu_items" ("menu_id", "is_active", "parent_id", "position");

CREATE TABLE "menu_audit_logs" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_state" JSONB,
    "new_state" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "menu_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "menu_audit_logs_resource_type_resource_id_created_at_idx"
  ON "menu_audit_logs" ("resource_type", "resource_id", "created_at");

CREATE INDEX "menu_audit_logs_actor_id_created_at_idx"
  ON "menu_audit_logs" ("actor_id", "created_at");
