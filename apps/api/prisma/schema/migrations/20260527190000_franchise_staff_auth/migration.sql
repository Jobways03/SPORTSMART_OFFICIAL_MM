-- Phase 159u (2026-05-27) — Franchise Staff Auth subsystem (B1/B2/B4).
-- Staff sessions, per-staff permission overrides, invitation columns, and a
-- nullable password (INVITED staff have none until activation).

ALTER TABLE "franchise_staff"
  ALTER COLUMN "password_hash" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "permissions" JSONB,
  ADD COLUMN IF NOT EXISTS "invite_token_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "invite_expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "franchise_staff_invite_token_hash_idx"
  ON "franchise_staff" ("invite_token_hash");

CREATE TABLE IF NOT EXISTS "franchise_staff_sessions" (
  "id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "refresh_token" TEXT NOT NULL,
  "user_agent" TEXT,
  "ip_address" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_staff_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_staff_sessions_staff_id_idx"
  ON "franchise_staff_sessions" ("staff_id");
CREATE INDEX IF NOT EXISTS "franchise_staff_sessions_refresh_token_idx"
  ON "franchise_staff_sessions" ("refresh_token");
CREATE INDEX IF NOT EXISTS "franchise_staff_sessions_staff_id_revoked_at_idx"
  ON "franchise_staff_sessions" ("staff_id", "revoked_at");
ALTER TABLE "franchise_staff_sessions"
  ADD CONSTRAINT "franchise_staff_sessions_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "franchise_staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
