-- Phase 32 (2026-05-21) — drop IN_REVIEW from ModerationStatus.
--
-- Zero rows in production carry this value (no code path writes it),
-- so the type-recast USING moderation_status::text::"ModerationStatus_new"
-- below is safe. Postgres doesn't support DROP VALUE on an enum
-- directly; the canonical workaround is rename → create new →
-- type-cast existing column → drop old.

ALTER TYPE "ModerationStatus" RENAME TO "ModerationStatus_old";

CREATE TYPE "ModerationStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED'
);

-- NOTE: the products.moderationStatus field carries no @map in catalog.prisma,
-- so the actual column is camelCase "moderationStatus" (not snake_case). The
-- original migration assumed snake_case and failed (column does not exist).
-- Fixed 2026-05-26 to reference the real column name.
ALTER TABLE "products"
  ALTER COLUMN "moderationStatus" DROP DEFAULT,
  ALTER COLUMN "moderationStatus" TYPE "ModerationStatus"
    USING "moderationStatus"::text::"ModerationStatus",
  ALTER COLUMN "moderationStatus" SET DEFAULT 'PENDING';

DROP TYPE "ModerationStatus_old";
