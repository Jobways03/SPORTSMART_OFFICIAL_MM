-- Sprint 3 Story 2.2 — buyer-facing wishlist.
--
-- Distinct from cart: no inventory reservation, no priced snapshot.
-- Variant id is nullable so customers can favourite a product
-- abstractly ("any size") or a specific SKU. Unique on
-- (user, product, variant) with the standard ANSI-NULL-distinct
-- behaviour, so "Product X any variant" and "Product X variant V1"
-- can both coexist as separate slots.

CREATE TABLE "wishlist_items" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_id" TEXT,
  "note"       VARCHAR(280),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- One slot per (user, product, variant). NULL variant_id is treated
-- as distinct per ANSI SQL, which is intentional here — see the
-- comment in wishlist.prisma.
CREATE UNIQUE INDEX "wishlist_items_user_id_product_id_variant_id_key"
  ON "wishlist_items"("user_id", "product_id", "variant_id");

-- "List my wishlist newest-first" — primary read pattern. The
-- created_at DESC ordering is encoded in the index so the page-1
-- read avoids a separate sort step.
CREATE INDEX "wishlist_items_user_id_created_at_idx"
  ON "wishlist_items"("user_id", "created_at" DESC);

ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
