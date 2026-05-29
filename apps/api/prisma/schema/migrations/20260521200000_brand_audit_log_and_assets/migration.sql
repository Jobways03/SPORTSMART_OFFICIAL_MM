-- Phase 35 (2026-05-21) — Brand audit log + Cloudinary publicId
-- tracking + query-pattern indexes + parity-with-Category SEO cols.
--
-- The new `logo_public_id` is the Cloudinary asset identifier; storing
-- it alongside `logo_url` lets the admin delete the prior asset when
-- a logo is replaced or the brand is hard-deleted. Pre-Phase-35 every
-- replacement orphaned the previous Cloudinary blob.
--
-- The new `description` + `meta_title` + `meta_description` mirror
-- the columns already on the Category model (Phase 33), so brand
-- landing pages can carry their own SEO snippets.

ALTER TABLE "brands"
  ADD COLUMN "logo_public_id" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "meta_title" TEXT,
  ADD COLUMN "meta_description" TEXT;

-- Phase 35 — query-pattern indexes for the public storefront listing.
CREATE INDEX "brands_is_active_idx" ON "brands" ("is_active");
CREATE INDEX "brands_is_active_name_idx" ON "brands" ("is_active", "name");

-- Phase 35 — mutation audit log.
CREATE TYPE "BrandAuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'DEACTIVATE',
  'LOGO_CHANGE',
  'BULK_ASSIGN'
);

CREATE TABLE "brand_audit_logs" (
  "id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "action" "BrandAuditAction" NOT NULL,
  "admin_id" TEXT,
  "previous_state" JSONB,
  "new_state" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "brand_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brand_audit_logs_brand_id_created_at_idx"
  ON "brand_audit_logs" ("brand_id", "created_at");

CREATE INDEX "brand_audit_logs_admin_id_created_at_idx"
  ON "brand_audit_logs" ("admin_id", "created_at");

ALTER TABLE "brand_audit_logs"
  ADD CONSTRAINT "brand_audit_logs_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
