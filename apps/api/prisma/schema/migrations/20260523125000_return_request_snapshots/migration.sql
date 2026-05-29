-- Phase 93 (2026-05-23) — Customer Return Request hardening.
--
-- Gap #8  — sellerId/franchiseId/nodeType snapshot on Return
-- Gap #23 — cancellation detail columns
-- Plus seller-dashboard composite indexes.

ALTER TABLE "returns"
  ADD COLUMN "seller_id_snapshot"     TEXT,
  ADD COLUMN "franchise_id_snapshot"  TEXT,
  ADD COLUMN "node_type_snapshot"     TEXT,
  ADD COLUMN "cancelled_at"           TIMESTAMP(3),
  ADD COLUMN "cancelled_by"           TEXT,
  ADD COLUMN "cancelled_by_role"      TEXT,
  ADD COLUMN "cancellation_reason"    TEXT;

CREATE INDEX "returns_seller_id_snapshot_status_created_at_idx"
  ON "returns" ("seller_id_snapshot", "status", "created_at" DESC);
CREATE INDEX "returns_franchise_id_snapshot_status_created_at_idx"
  ON "returns" ("franchise_id_snapshot", "status", "created_at" DESC);
