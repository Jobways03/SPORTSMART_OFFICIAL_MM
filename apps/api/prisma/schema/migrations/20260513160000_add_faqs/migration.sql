-- Story 6.1 — FAQ CMS for the help center.

CREATE TABLE "faqs" (
  "id"            TEXT NOT NULL,
  "category"      TEXT NOT NULL,
  "question"      TEXT NOT NULL,
  "answer"        TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active"     BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- Primary read pattern: "show all active FAQs grouped by category,
-- sorted by display_order". The compound (category, display_order)
-- index covers the ORDER BY when filtering by category.
CREATE INDEX "faqs_category_display_order_idx"
  ON "faqs"("category", "display_order");

-- Secondary filter: "active only" for the public surface. The Prisma
-- query path uses isActive in the WHERE so a dedicated index on the
-- boolean keeps inactive drafts out of seq scans cheaply.
CREATE INDEX "faqs_is_active_idx" ON "faqs"("is_active");
