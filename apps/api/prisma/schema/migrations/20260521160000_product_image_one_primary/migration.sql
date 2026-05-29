-- Phase 29 (2026-05-21) — at most one primary image per product.
--
-- Pre-Phase-29 the image-upload controller computed
-- `isPrimary = existingImages === 0` outside any transaction. Two
-- concurrent first-image uploads both saw count=0 and both inserted
-- with isPrimary=true. The partial unique index makes the database
-- enforce the invariant atomically — the second concurrent insert
-- gets a Postgres unique-violation (P2002) and the application
-- retries with isPrimary=false.
--
-- Prisma's schema DSL does not support partial unique indexes, so the
-- index is declared in raw SQL here and documented as a comment in
-- catalog.prisma.

CREATE UNIQUE INDEX "product_images_one_primary_idx"
  ON "product_images" ("product_id")
  WHERE "is_primary" = TRUE;
