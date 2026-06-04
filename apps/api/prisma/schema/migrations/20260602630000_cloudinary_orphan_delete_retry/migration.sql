-- Cluster E (#217-#5) — Cloudinary orphan-sweep delete retry tracking.
--
-- The daily orphan sweep deletes Cloudinary assets (and their DB rows)
-- for images whose parent Product/Variant has been soft-deleted past the
-- retention window. Pre-fix a row whose delete kept failing was retried
-- on EVERY tick forever, never escalating. These columns let the sweep:
--   * count attempts per row (delete_attempt_count),
--   * preserve the last error for ops triage (last_delete_error),
--   * and, past CLOUDINARY_ORPHAN_DELETE_RETRY_CAP, mark the row
--     delete_failed=TRUE so it is excluded from future sweeps and becomes
--     queryable instead of churning silently.
--
-- All three columns are NOT NULL with defaults (or nullable text), so
-- this is a metadata-only ALTER — no table rewrite, no backfill.

ALTER TABLE "product_images"
  ADD COLUMN IF NOT EXISTS "delete_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_delete_error"    TEXT,
  ADD COLUMN IF NOT EXISTS "delete_failed"        BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "product_variant_images"
  ADD COLUMN IF NOT EXISTS "delete_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_delete_error"    TEXT,
  ADD COLUMN IF NOT EXISTS "delete_failed"        BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial indexes so the sweep's "permanently-failed" exclusion stays
-- cheap as the soft-deleted backlog grows. The sweep filters on
-- delete_failed = FALSE; index that hot predicate.
CREATE INDEX IF NOT EXISTS "product_images_delete_failed_idx"
  ON "product_images" ("delete_failed")
  WHERE "delete_failed" = TRUE;

CREATE INDEX IF NOT EXISTS "product_variant_images_delete_failed_idx"
  ON "product_variant_images" ("delete_failed")
  WHERE "delete_failed" = TRUE;
