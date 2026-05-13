-- Blog posts — admin-authored news/articles for the storefront /blogs page.

CREATE TYPE "BlogPostStatus" AS ENUM ('VISIBLE', 'HIDDEN');

CREATE TABLE "blog_posts" (
  "id"             TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "excerpt"        TEXT,
  "content_html"   TEXT NOT NULL DEFAULT '',
  "image_url"      TEXT,
  "author"         TEXT,
  "category"       TEXT NOT NULL DEFAULT 'News',
  "tags"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"         "BlogPostStatus" NOT NULL DEFAULT 'HIDDEN',
  "published_at"   TIMESTAMP(3),
  "meta_title"     TEXT,
  "meta_desc"      TEXT,
  "created_by_id"  TEXT,
  "updated_by_id"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");
CREATE INDEX "blog_posts_status_published_at_idx"
  ON "blog_posts"("status", "published_at");
CREATE INDEX "blog_posts_category_status_idx"
  ON "blog_posts"("category", "status");
