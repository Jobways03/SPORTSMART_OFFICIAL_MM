-- Phase 77 (2026-05-22) — allocator audit Gap #7 + Gap #25.
--
-- 1. Drop dead PincodeDatabase model (Gap #25). Allocator uses
--    PostOffice as the canonical pincode → coords lookup; the
--    PincodeDatabase table had zero code references.
-- 2. Add allocation_candidates child table (Gap #7) for forensic
--    persistence of the full ranked candidate list per allocation.

-- ── 1. Drop dead pincode_database table ─────────────────────
DROP TABLE IF EXISTS "pincode_database";

-- ── 2. AllocationCandidate ──────────────────────────────────
CREATE TABLE "allocation_candidates" (
  "id"                 TEXT PRIMARY KEY,
  "allocation_log_id"  TEXT NOT NULL,
  "rank"               INTEGER NOT NULL,
  "node_type"          TEXT NOT NULL,
  "seller_id"          TEXT,
  "franchise_id"       TEXT,
  "mapping_id"         TEXT NOT NULL,
  "distance_km"        DECIMAL(10,2),
  "available_stock"    INTEGER NOT NULL,
  "dispatch_sla"       INTEGER NOT NULL,
  "score"              DECIMAL(10,4) NOT NULL,
  "excluded"           BOOLEAN NOT NULL DEFAULT FALSE,
  "exclude_reason"     TEXT,
  FOREIGN KEY ("allocation_log_id") REFERENCES "allocation_logs"("id") ON DELETE CASCADE
);

CREATE INDEX "allocation_candidates_allocation_log_id_idx"
  ON "allocation_candidates" ("allocation_log_id");
CREATE INDEX "allocation_candidates_seller_id_idx"
  ON "allocation_candidates" ("seller_id");
CREATE INDEX "allocation_candidates_franchise_id_idx"
  ON "allocation_candidates" ("franchise_id");
