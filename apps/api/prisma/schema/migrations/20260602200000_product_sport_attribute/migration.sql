-- Phase 192 (#4) — structured sport attribute on Product (replaces the
-- storefront's title-text-search workaround for ?sport= links).

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sport" TEXT;

CREATE INDEX IF NOT EXISTS "products_sport_status_idx" ON "products" ("sport", "status");
