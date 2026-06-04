-- Phase 194 (#5) — built-in filter configs (brand / price_range /
-- availability) had NO uniqueness guard per scope. The Phase-40 migration
-- added `storefront_filters_def_scope_unique` only for metafield-backed
-- rows (WHERE metafield_definition_id IS NOT NULL). Nothing stopped an
-- admin from creating two "brand" built-in filters for the same scope,
-- which would render the same facet twice and make the override-merge in
-- getFilterConfigsForContext non-deterministic (Map.set keeps the last).
--
-- This adds the symmetric partial unique for built-in rows and defensively
-- de-duplicates any pre-existing collisions first (keeping the earliest
-- created row, id as tiebreak) so the index can be created safely.

-- 1. Defensive dedupe — keep exactly one row per (built_in_type, scope).
DELETE FROM "storefront_filters" a
USING "storefront_filters" b
WHERE a."built_in_type" IS NOT NULL
  AND b."built_in_type" IS NOT NULL
  AND a."built_in_type" = b."built_in_type"
  AND COALESCE(a."scope_type", '') = COALESCE(b."scope_type", '')
  AND COALESCE(a."scope_id", '') = COALESCE(b."scope_id", '')
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );

-- 2. Partial unique on (built_in_type, scope_type, scope_id) where
--    built_in_type IS NOT NULL. COALESCE collapses NULL-is-distinct so
--    two GLOBAL configs (scope_id NULL) for the same built-in collide.
CREATE UNIQUE INDEX "storefront_filters_builtin_scope_unique"
  ON "storefront_filters" ("built_in_type", COALESCE("scope_type", ''), COALESCE("scope_id", ''))
  WHERE "built_in_type" IS NOT NULL;
