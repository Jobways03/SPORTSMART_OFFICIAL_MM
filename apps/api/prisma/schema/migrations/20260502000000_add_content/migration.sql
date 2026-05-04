CREATE TYPE "BannerSlot" AS ENUM ('HOMEPAGE_HERO', 'CATEGORY_HEADER', 'BRAND_HEADER', 'CART_BANNER', 'CHECKOUT_BANNER');

CREATE TABLE "banners" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slot" "BannerSlot" NOT NULL,
  "title" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "cta_url" TEXT,
  "scope_id" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMP(3),
  "ends_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "banners_slot_active_position_idx" ON "banners"("slot", "active", "position");
CREATE INDEX "banners_scope_id_idx" ON "banners"("scope_id");

CREATE TABLE "static_pages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "meta_title" TEXT,
  "meta_desc" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "static_pages_published_idx" ON "static_pages"("published");

CREATE TABLE "faq_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "category" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "faq_entries_category_active_position_idx" ON "faq_entries"("category", "active", "position");
