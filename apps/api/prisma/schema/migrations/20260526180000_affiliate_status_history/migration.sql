-- Phase 156 (2026-05-26) — Affiliate Application audit.
-- Append-only status-transition log (full ordered timeline; the dedicated
-- actor columns on affiliates capture only the latest actor per type).
CREATE TABLE "affiliate_status_history" (
  "id"                   TEXT NOT NULL,
  "affiliate_id"         TEXT NOT NULL,
  "from_status"          TEXT,
  "to_status"            TEXT NOT NULL,
  "changed_by_admin_id"  TEXT,
  "reason"               TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_status_history_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "affiliate_status_history"
  ADD CONSTRAINT "affiliate_status_history_affiliate_id_fkey"
  FOREIGN KEY ("affiliate_id") REFERENCES "affiliates" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "affiliate_status_history_affiliate_id_created_at_idx"
  ON "affiliate_status_history" ("affiliate_id", "created_at");
