-- Storefront content blocks — one row per homepage slot (hero-slide-1,
-- sport-running, deal-goggles, banner-tennis, brand-adidas, …).

CREATE TABLE "storefront_content_blocks" (
  "id"             TEXT NOT NULL,
  "slot"           TEXT NOT NULL,
  "image_url"      TEXT,
  "eyebrow"        TEXT,
  "headline"       TEXT,
  "subhead"        TEXT,
  "cta_label"      TEXT,
  "cta_href"       TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "updated_by_id"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storefront_content_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_content_blocks_slot_key"
  ON "storefront_content_blocks"("slot");
CREATE INDEX "storefront_content_blocks_active_idx"
  ON "storefront_content_blocks"("active");
