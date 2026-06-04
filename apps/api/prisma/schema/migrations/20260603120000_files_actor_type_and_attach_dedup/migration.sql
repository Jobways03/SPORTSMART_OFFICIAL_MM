-- Phase 250/252 — files security hardening: actor-type disambiguation on
-- uploads + idempotent attach. Additive + safe.

-- #250 — persona of the uploader (CUSTOMER/SELLER/FRANCHISE/ADMIN/AFFILIATE).
ALTER TABLE "file_metadata"
  ADD COLUMN IF NOT EXISTS "uploaded_by_type" TEXT;

-- #252 (#12) — de-duplicate any existing (file_id, resource, resource_id)
-- triplets before adding the unique index (keep the earliest row). The
-- central attach endpoint is barely used, so this is near-empty in practice.
DELETE FROM "file_attachments" a
USING "file_attachments" b
WHERE a.ctid > b.ctid
  AND a.file_id = b.file_id
  AND a.resource = b.resource
  AND a.resource_id = b.resource_id;

CREATE UNIQUE INDEX IF NOT EXISTS "file_attachments_file_id_resource_resource_id_key"
  ON "file_attachments" ("file_id", "resource", "resource_id");
