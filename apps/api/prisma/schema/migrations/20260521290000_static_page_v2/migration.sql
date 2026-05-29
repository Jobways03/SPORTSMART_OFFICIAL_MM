-- Phase 49 (2026-05-21) — static-page + FAQ hardening.

CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "static_pages"
  ADD COLUMN "canonical_url" TEXT,
  ADD COLUMN "og_image" TEXT,
  ADD COLUMN "no_index" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "updated_by_id" TEXT;

-- Lockstep backfill: existing rows with published=true become
-- status=PUBLISHED so the new column is consistent on rollout.
UPDATE "static_pages" SET "status" = 'PUBLISHED' WHERE "published" = TRUE;

CREATE INDEX "static_pages_status_idx" ON "static_pages" ("status");
CREATE INDEX "static_pages_deleted_at_idx" ON "static_pages" ("deleted_at");

ALTER TABLE "faq_entries"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "updated_by_id" TEXT;

CREATE UNIQUE INDEX "faq_entries_slug_key" ON "faq_entries" ("slug");
CREATE INDEX "faq_entries_deleted_at_idx" ON "faq_entries" ("deleted_at");

CREATE TABLE "content_page_audit_logs" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_title" TEXT,
    "prev_body" TEXT,
    "new_title" TEXT,
    "new_body" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_page_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_page_audit_logs_resource_type_resource_id_created_at_idx"
  ON "content_page_audit_logs" ("resource_type", "resource_id", "created_at");
CREATE INDEX "content_page_audit_logs_actor_id_created_at_idx"
  ON "content_page_audit_logs" ("actor_id", "created_at");
