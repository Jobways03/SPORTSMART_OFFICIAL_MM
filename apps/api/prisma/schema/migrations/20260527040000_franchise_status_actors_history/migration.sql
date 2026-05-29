-- Phase 159i (2026-05-27) — Franchise status actor/reason + history.
ALTER TABLE "franchise_partners"
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspended_by" TEXT,
  ADD COLUMN IF NOT EXISTS "suspension_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deactivated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deactivation_reason" TEXT;

CREATE TABLE IF NOT EXISTS "franchise_status_history" (
  "id" TEXT NOT NULL,
  "franchise_id" TEXT NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "changed_by_admin_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_status_history_franchise_id_created_at_idx"
  ON "franchise_status_history" ("franchise_id", "created_at");
ALTER TABLE "franchise_status_history"
  ADD CONSTRAINT "franchise_status_history_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
