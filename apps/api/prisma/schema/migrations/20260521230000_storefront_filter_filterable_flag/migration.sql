-- Phase 40 (2026-05-21) — Storefront filter / isFilterable migration.
--
-- Three categories of change:
--
-- 1. MetafieldDefinition gains four columns + one index:
--      isFilterable           Boolean   default false
--      default_filter_type    String?
--      default_filter_label   String?
--      filter_display_order   Int       default 0
--      INDEX (is_filterable, category_id)
--    The flag is the single source of truth for "is this attribute a
--    storefront filter?". StorefrontFilter rows remain as optional
--    per-scope overrides — most categories won't need them anymore.
--
-- 2. StorefrontFilter.metafieldDefinition FK switches Cascade → Restrict.
--    Pre-Phase-40 deleting a definition silently destroyed every
--    per-scope filter config pointing at it. The admin controller
--    already prevents the cascade chain (it routes to deactivate when
--    values exist post-Phase-39); this just hardens the contract at
--    the DB layer for the rare manual SQL path.
--
-- 3. New partial unique index on storefront_filters prevents duplicate
--    per-scope configs for the same definition. Declared raw because
--    Prisma's DSL does not support partial indexes.
--
-- 4. GIN index on product_metafields.value_json — without it the
--    `@>` and `?|` JSONB operators that compute MULTI_SELECT facets
--    fall back to seq scan (line ~360 of prisma-storefront.repository).
--    On the 1.4M-row product_metafields table at staging that's
--    100ms+ per filter; with the GIN it drops to <5ms.

-- 1. MetafieldDefinition new columns
ALTER TABLE "metafield_definitions"
  ADD COLUMN "is_filterable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "default_filter_type" TEXT,
  ADD COLUMN "default_filter_label" TEXT,
  ADD COLUMN "filter_display_order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "metafield_definitions_is_filterable_category_id_idx"
  ON "metafield_definitions" ("is_filterable", "category_id");

-- 2. StorefrontFilter FK Cascade → Restrict
ALTER TABLE "storefront_filters"
  DROP CONSTRAINT "storefront_filters_metafield_definition_id_fkey";

ALTER TABLE "storefront_filters"
  ADD CONSTRAINT "storefront_filters_metafield_definition_id_fkey"
  FOREIGN KEY ("metafield_definition_id")
  REFERENCES "metafield_definitions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Partial unique on (metafield_definition_id, scope_type, scope_id)
--    where metafield_definition_id IS NOT NULL.
--    COALESCE on scope_id collapses the NULL-is-distinct semantics so
--    two GLOBAL configs for the same definition still collide.
CREATE UNIQUE INDEX "storefront_filters_def_scope_unique"
  ON "storefront_filters" ("metafield_definition_id", COALESCE("scope_type", ''), COALESCE("scope_id", ''))
  WHERE "metafield_definition_id" IS NOT NULL;

-- 4. GIN on product_metafields.value_json
CREATE INDEX IF NOT EXISTS "product_metafields_value_json_gin_idx"
  ON "product_metafields" USING GIN ("value_json" jsonb_path_ops);
