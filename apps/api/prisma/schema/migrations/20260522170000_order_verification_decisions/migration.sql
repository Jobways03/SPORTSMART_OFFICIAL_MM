-- Phase 74 (2026-05-22) — Phase 73 approve/reject audit hardening.
-- Closes Gaps #2 (rejectedBy/At/Reason), #8 (rejecter FK), #12
-- (previousPaymentStatus snapshot), #15 (REJECTED OrderStatus enum
-- value), #3/#18 (OrderVerificationDecision append-only audit table).

-- ── 1. Add REJECTED to OrderStatus enum ───────────────────────
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- ── 2. MasterOrder columns ────────────────────────────────────
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "rejected_at"             TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "rejected_by"             TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_reason"        TEXT,
  ADD COLUMN IF NOT EXISTS "previous_payment_status" "OrderPaymentStatus";

-- Orphan-clean before FK constraint.
UPDATE "master_orders" SET "rejected_by" = NULL
WHERE  "rejected_by" IS NOT NULL
  AND  "rejected_by" NOT IN (SELECT "id" FROM "admins");

ALTER TABLE "master_orders"
  ADD CONSTRAINT "master_orders_rejected_by_fkey"
  FOREIGN KEY ("rejected_by") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. OrderVerificationDecision table + enum ─────────────────
CREATE TYPE "OrderVerificationDecisionType" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "order_verification_decisions" (
  "id"              TEXT PRIMARY KEY,
  "master_order_id" TEXT NOT NULL,
  "decision"        "OrderVerificationDecisionType" NOT NULL,
  "decided_by"      TEXT NOT NULL,
  "decided_at"      TIMESTAMP NOT NULL DEFAULT NOW(),
  "reason"          TEXT,
  "remarks"         TEXT,
  "metadata_json"   JSONB,
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders" ("id") ON DELETE CASCADE
);

CREATE INDEX "order_verification_decisions_master_order_id_decided_at_idx"
  ON "order_verification_decisions" ("master_order_id", "decided_at" DESC);

CREATE INDEX "order_verification_decisions_decided_by_decided_at_idx"
  ON "order_verification_decisions" ("decided_by", "decided_at");

CREATE INDEX "order_verification_decisions_decision_decided_at_idx"
  ON "order_verification_decisions" ("decision", "decided_at");
