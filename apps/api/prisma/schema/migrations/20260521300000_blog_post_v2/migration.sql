-- Phase 50 (2026-05-21) — blog-post hardening.

ALTER TYPE "BlogPostStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "BlogPostStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

ALTER TABLE "blog_posts"
  ADD COLUMN "image_public_id" TEXT,
  ADD COLUMN "image_alt" TEXT,
  ADD COLUMN "canonical_url" TEXT,
  ADD COLUMN "og_image" TEXT,
  ADD COLUMN "no_index" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "blog_posts_deleted_at_idx" ON "blog_posts" ("deleted_at");

CREATE TABLE "blog_post_audit_logs" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_state" JSONB,
    "new_state" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blog_post_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "blog_post_audit_logs_post_id_created_at_idx"
  ON "blog_post_audit_logs" ("post_id", "created_at");
CREATE INDEX "blog_post_audit_logs_actor_id_created_at_idx"
  ON "blog_post_audit_logs" ("actor_id", "created_at");
