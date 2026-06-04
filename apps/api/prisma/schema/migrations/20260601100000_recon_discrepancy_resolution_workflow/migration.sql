-- Phase 174 — Discrepancy Resolution Flow audit remediation.
--
-- Builds the structured-investigation workflow on top of the #173 detection
-- machinery: investigation-phase ownership stamps, triage assignment, a
-- last-modified stamp, and an immutable per-discrepancy status-transition trail.
--
-- NOTE: no enum change. IN_REVIEW (added in #173) already IS the spec's
-- "INVESTIGATING" intermediate state; #174 makes that phase first-class by
-- recording who entered it and when, rather than renaming the value across the
-- whole stack.

-- ── #1 investigation-phase tracking + #6 assignment + #13 updatedAt ──────────
ALTER TABLE "reconciliation_discrepancies"
  ADD COLUMN IF NOT EXISTS "investigating_by_admin_id" TEXT,
  ADD COLUMN IF NOT EXISTS "investigating_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assigned_to_admin_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "assigned_at"               TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updated_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- #6/#15 assignee-filtered triage queue.
CREATE INDEX IF NOT EXISTS "recon_disc_assigned_status_idx"
  ON "reconciliation_discrepancies" ("assigned_to_admin_id", "status");

-- ── #2 immutable status-transition trail ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reconciliation_discrepancy_status_history" (
  "id"             TEXT NOT NULL,
  "discrepancy_id" TEXT NOT NULL,
  "from_status"    "DiscrepancyStatus",
  "to_status"      "DiscrepancyStatus" NOT NULL,
  "actor_admin_id" TEXT,
  "actor_role"     TEXT,
  "notes"          TEXT,
  "occurred_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recon_disc_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "recon_disc_status_history_disc_occurred_idx"
  ON "reconciliation_discrepancy_status_history" ("discrepancy_id", "occurred_at" DESC);

ALTER TABLE "reconciliation_discrepancy_status_history"
  ADD CONSTRAINT "recon_disc_status_history_discrepancy_fkey"
  FOREIGN KEY ("discrepancy_id")
  REFERENCES "reconciliation_discrepancies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
