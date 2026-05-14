-- Story (Phase 5 / Category) — add banner + SEO fields to Category.
-- Both columns nullable so existing rows don't need backfill.
-- The storefront falls back to (name, description) when these are empty.

ALTER TABLE "categories"
  ADD COLUMN "banner_url"      TEXT,
  ADD COLUMN "meta_title"      TEXT,
  ADD COLUMN "meta_description" TEXT;
