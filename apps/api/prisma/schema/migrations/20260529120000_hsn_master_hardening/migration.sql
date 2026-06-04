-- Phase 161 (HSN Master flow audit remediation).
--
--   B2   created_by / updated_by — actor attribution (was discarded).
--   #12  version — optimistic-concurrency token (last-write-wins race).
--   #11  deactivation_reason — captured when a code is deactivated.
--   #8   hsn_master_history — append-only before/after field-change trail.

ALTER TABLE "hsn_master"
  ADD COLUMN "created_by"          TEXT,
  ADD COLUMN "updated_by"          TEXT,
  ADD COLUMN "version"             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deactivation_reason" TEXT;

CREATE TABLE "hsn_master_history" (
  "id"            TEXT NOT NULL,
  "hsn_master_id" TEXT NOT NULL,
  "hsn_code"      TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "old_values"    JSONB,
  "new_values"    JSONB,
  "changed_by"    TEXT,
  "reason"        TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hsn_master_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hsn_master_history_hsn_master_id_created_at_idx"
  ON "hsn_master_history" ("hsn_master_id", "created_at" DESC);
CREATE INDEX "hsn_master_history_hsn_code_created_at_idx"
  ON "hsn_master_history" ("hsn_code", "created_at" DESC);

ALTER TABLE "hsn_master_history"
  ADD CONSTRAINT "hsn_master_history_hsn_master_id_fkey"
  FOREIGN KEY ("hsn_master_id") REFERENCES "hsn_master"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
