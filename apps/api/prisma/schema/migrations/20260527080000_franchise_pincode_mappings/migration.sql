-- Phase 159m (2026-05-27) — Admin-assigned pincode → franchise coverage map.
--
-- Routing (serviceability + allocation) consults these in "supplement" mode:
-- a pincode with ≥1 active mapping restricts eligibility to mapped franchises
-- (priority desc, then distance); an unmapped pincode falls back to distance.

CREATE TABLE IF NOT EXISTS "franchise_pincode_mappings" (
  "id" TEXT NOT NULL,
  "franchise_id" TEXT NOT NULL,
  "pincode" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "assigned_by_id" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_by_id" TEXT,
  "removed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "franchise_pincode_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "franchise_pincode_mappings_franchise_id_pincode_key"
  ON "franchise_pincode_mappings" ("franchise_id", "pincode");
CREATE INDEX IF NOT EXISTS "franchise_pincode_mappings_pincode_is_active_idx"
  ON "franchise_pincode_mappings" ("pincode", "is_active");
CREATE INDEX IF NOT EXISTS "franchise_pincode_mappings_franchise_id_is_active_idx"
  ON "franchise_pincode_mappings" ("franchise_id", "is_active");
ALTER TABLE "franchise_pincode_mappings"
  ADD CONSTRAINT "franchise_pincode_mappings_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "franchise_pincode_mapping_events" (
  "id" TEXT NOT NULL,
  "mapping_id" TEXT,
  "franchise_id" TEXT NOT NULL,
  "pincode" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "old_value" JSONB,
  "new_value" JSONB,
  "reason" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_pincode_mapping_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_pincode_mapping_events_franchise_id_created_at_idx"
  ON "franchise_pincode_mapping_events" ("franchise_id", "created_at");
CREATE INDEX IF NOT EXISTS "franchise_pincode_mapping_events_mapping_id_idx"
  ON "franchise_pincode_mapping_events" ("mapping_id");
ALTER TABLE "franchise_pincode_mapping_events"
  ADD CONSTRAINT "franchise_pincode_mapping_events_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allocation snapshot: which territory mapping authorised the decision.
ALTER TABLE "allocation_logs"
  ADD COLUMN IF NOT EXISTS "allocated_pincode_mapping_id" TEXT;
