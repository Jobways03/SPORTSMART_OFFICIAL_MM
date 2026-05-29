-- Phase 159t (2026-05-27) — Franchise Staff Management audit (data model).
-- #12 status enum; #8/#15 lifecycle/activity columns; #5/#6 per-franchise email
-- uniqueness (was global → existence-leak + multi-franchise block + orphaned
-- soft-deletes); #16 per-franchise phone uniqueness.

DO $$ BEGIN
  CREATE TYPE "FranchiseStaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "franchise_staff"
  ADD COLUMN IF NOT EXISTS "status" "FranchiseStaffStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "suspended_by" TEXT,
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspension_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

-- Backfill status from the legacy isActive boolean.
UPDATE "franchise_staff" SET "status" = 'TERMINATED' WHERE "is_active" = false;

-- #5/#6 — replace the global email unique with a per-franchise partial unique
-- that ignores TERMINATED rows (so a re-hire can reuse the email).
DROP INDEX IF EXISTS "franchise_staff_email_key";
DROP INDEX IF EXISTS "franchise_staff_email_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "franchise_staff_franchise_email_active_key"
  ON "franchise_staff" ("franchise_id", "email")
  WHERE "status" <> 'TERMINATED';

-- #16 — per-franchise phone uniqueness (nullable-tolerant, ignores TERMINATED).
CREATE UNIQUE INDEX IF NOT EXISTS "franchise_staff_franchise_phone_active_key"
  ON "franchise_staff" ("franchise_id", "phone")
  WHERE "phone" IS NOT NULL AND "status" <> 'TERMINATED';

CREATE INDEX IF NOT EXISTS "franchise_staff_franchise_id_status_idx"
  ON "franchise_staff" ("franchise_id", "status");
