-- ============================================
-- Phase 8 (PR 8.1) — Audit chain anchors
-- ============================================
-- Append-only Merkle-style pins of the AuditLog hash chain. The
-- verifier reads the latest anchor first (PRIMARY KEY seek), confirms
-- the recomputed hash matches, then walks forward from that anchor.
-- Without anchors, every verification would walk from the genesis
-- row — O(n) per call. With anchors, it's O(rows_since_last_anchor).

CREATE TABLE "audit_chain_anchors" (
    "sequence"             INTEGER      NOT NULL,
    "up_to_audit_log_id"   TEXT         NOT NULL,
    "expected_hash"        TEXT         NOT NULL,
    "rows_covered"         INTEGER      NOT NULL,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_chain_anchors_pkey" PRIMARY KEY ("sequence")
);

CREATE INDEX "audit_chain_anchors_created_at_idx"
    ON "audit_chain_anchors" ("created_at");
