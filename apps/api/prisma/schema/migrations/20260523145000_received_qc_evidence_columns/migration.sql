-- Phase 96 + 97 (2026-05-23) — Mark Received + QC audit closures.
--
-- Adds:
--   • Return.received_by_actor_type        (Mark Received Gap #20)
--   • Return.parcel_condition              (Mark Received Gap #17)
--   • Return.received_bypassed_in_transit  (Mark Received Gap #14)
--   • Return.received_bypass_reason        (Mark Received Gap #14)
--   • Return.qc_status                     (QC Gap #20)
--   • Return.qc_claimed_by / claimed_at / lock_expires_at (QC race / lock)
--   • ReturnEvidence.return_item_id        (QC Gap #8)
--   • ReturnEvidence.evidence_type         (QC Gap #8)
--   • ReturnEvidence.width / height / bytes / content_hash (QC Gap #27)
--   • AdminTaskKind enum values RETURN_QC_PENDING, RETURN_NOTIFICATION_NO_NODE
--   • Indexes for QC dashboard hot queries

ALTER TABLE "returns"
  ADD COLUMN "received_by_actor_type"       TEXT,
  ADD COLUMN "parcel_condition"             TEXT,
  ADD COLUMN "received_bypassed_in_transit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "received_bypass_reason"       TEXT,
  ADD COLUMN "qc_status"                    TEXT,
  ADD COLUMN "qc_claimed_by"                TEXT,
  ADD COLUMN "qc_claimed_at"                TIMESTAMP(3),
  ADD COLUMN "qc_lock_expires_at"           TIMESTAMP(3);

ALTER TABLE "return_evidence"
  ADD COLUMN "return_item_id"  TEXT,
  ADD COLUMN "evidence_type"   TEXT,
  ADD COLUMN "width"           INTEGER,
  ADD COLUMN "height"          INTEGER,
  ADD COLUMN "bytes"           INTEGER,
  ADD COLUMN "content_hash"    TEXT;

-- FK + index for per-item evidence linkage. SET NULL on delete so
-- legacy return-level evidence is preserved when an item is deleted.
ALTER TABLE "return_evidence"
  ADD CONSTRAINT "return_evidence_return_item_id_fkey"
  FOREIGN KEY ("return_item_id") REFERENCES "return_items"("id") ON DELETE SET NULL;
CREATE INDEX "return_evidence_return_item_id_idx" ON "return_evidence"("return_item_id");

-- QC dashboard hot queries.
CREATE INDEX "returns_status_received_at_idx"            ON "returns" ("status", "received_at");
CREATE INDEX "returns_qc_decision_qc_completed_at_idx"   ON "returns" ("qc_decision", "qc_completed_at");
CREATE INDEX "returns_liability_party_qc_completed_idx"  ON "returns" ("liability_party", "qc_completed_at");
CREATE INDEX "return_items_qc_outcome_idx"               ON "return_items" ("qc_outcome");

-- AdminTaskKind extensions.
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'RETURN_QC_PENDING';
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'RETURN_NOTIFICATION_NO_NODE';
