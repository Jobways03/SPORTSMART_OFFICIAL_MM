-- Phase 161 (UQC Master flow audit remediation — sibling of the HSN master
-- hardening in 20260529120000).
--
--   B2   created_by / updated_by — actor attribution (never captured).
--   #9   version — optimistic-concurrency token (last-write-wins race).
--   #11  deactivation_reason — captured when a code is deactivated.
--   #7   uqc_master_history — append-only before/after field-change trail.

ALTER TABLE "uqc_master"
  ADD COLUMN "created_by"          TEXT,
  ADD COLUMN "updated_by"          TEXT,
  ADD COLUMN "version"             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deactivation_reason" TEXT;

CREATE TABLE "uqc_master_history" (
  "id"         TEXT NOT NULL,
  "uqc_id"     TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "old_values" JSONB,
  "new_values" JSONB,
  "changed_by" TEXT,
  "reason"     TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uqc_master_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uqc_master_history_uqc_id_created_at_idx"
  ON "uqc_master_history" ("uqc_id", "created_at" DESC);
CREATE INDEX "uqc_master_history_code_created_at_idx"
  ON "uqc_master_history" ("code", "created_at" DESC);

ALTER TABLE "uqc_master_history"
  ADD CONSTRAINT "uqc_master_history_uqc_id_fkey"
  FOREIGN KEY ("uqc_id") REFERENCES "uqc_master"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
