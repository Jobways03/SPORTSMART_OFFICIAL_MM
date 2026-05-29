-- Phase 138 — commission adjustment: full history + optimistic-lock + FK + index.

ALTER TABLE "commission_records" ADD COLUMN "is_adjusted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "commission_records" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "commission_records_adjusted_at_idx" ON "commission_records"("adjusted_at");

-- FK adjusted_by → admins (0 orphans verified; admins are soft-deleted, so
-- SET NULL never actually fires — it just lets the UI join the admin name).
ALTER TABLE "commission_records"
  ADD CONSTRAINT "commission_records_adjusted_by_fkey"
  FOREIGN KEY ("adjusted_by") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- One row per manual adjustment (the single columns only hold the latest).
CREATE TABLE "commission_adjustment_history" (
  "id"                   TEXT NOT NULL,
  "commission_record_id" TEXT NOT NULL,
  "from_admin_earning"   DECIMAL(10,2) NOT NULL,
  "to_admin_earning"     DECIMAL(10,2) NOT NULL,
  "from_platform_margin" DECIMAL(10,2) NOT NULL,
  "to_platform_margin"   DECIMAL(10,2) NOT NULL,
  "admin_id"             TEXT NOT NULL,
  "reason"               TEXT NOT NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_adjustment_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_adjustment_history_commission_record_id_created_at_idx"
  ON "commission_adjustment_history"("commission_record_id", "created_at");
ALTER TABLE "commission_adjustment_history"
  ADD CONSTRAINT "commission_adjustment_history_commission_record_id_fkey"
  FOREIGN KEY ("commission_record_id") REFERENCES "commission_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The adjust endpoint moves from the shared settlements.approve permission to a
-- granular settlements.adjustRecord. System roles are handled in the registry;
-- grant the new permission to any CUSTOM role that holds settlements.approve so
-- the split is additive (no lockout under PERMISSIONS_GUARD_STRICT=true).
INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", 'settlements.adjustRecord', NOW()
FROM "admin_custom_role_permissions" p
WHERE p."permission_key" = 'settlements.approve'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;
