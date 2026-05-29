-- Phase 73 (2026-05-22) — claim-flow audit Gap #14.
--
-- OrderClaimHistory: append-only audit trail of every claim
-- transition. Pre-Phase-73 the MasterOrder claim columns were
-- overwritten on every release / expiry / approve / reject /
-- force-release with no historical record.

-- ── 1. Enum ─────────────────────────────────────────────────
CREATE TYPE "OrderClaimReleaseReason" AS ENUM (
  'EXPLICIT_RELEASE',
  'TTL_EXPIRY',
  'APPROVED',
  'REJECTED',
  'FORCE_RELEASE',
  'ORDER_VIA_BYPASS'
);

-- ── 2. Table ────────────────────────────────────────────────
CREATE TABLE "order_claim_history" (
  "id"                    TEXT PRIMARY KEY,
  "master_order_id"       TEXT NOT NULL,
  "claimed_by_admin_id"   TEXT,
  "claimed_at"            TIMESTAMP NOT NULL,
  "released_at"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "duration_seconds"      INTEGER NOT NULL,
  "release_reason"        "OrderClaimReleaseReason" NOT NULL,
  "released_by_admin_id"  TEXT,
  "reason_note"           TEXT,
  "created_at"            TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders" ("id") ON DELETE CASCADE
);

CREATE INDEX "order_claim_history_master_order_id_released_at_idx"
  ON "order_claim_history" ("master_order_id", "released_at" DESC);

CREATE INDEX "order_claim_history_claimed_by_admin_id_released_at_idx"
  ON "order_claim_history" ("claimed_by_admin_id", "released_at");

CREATE INDEX "order_claim_history_release_reason_released_at_idx"
  ON "order_claim_history" ("release_reason", "released_at");

-- ── 3. CHECK constraint on master_orders claim invariants ──
-- Either all three claim columns are NULL (unclaimed), or all
-- three are set AND expires_at > claimed_at. Pre-Phase-73 a
-- direct SQL writer could leave the table half-populated; the
-- constraint blocks that going forward.
--
-- NOT VALID so the immediate constraint-check is skipped (any
-- pre-existing inconsistent rows surface on the follow-up
-- VALIDATE rather than blocking the migration). Operators run
-- `ALTER TABLE master_orders VALIDATE CONSTRAINT
-- chk_claim_consistency` after cleaning up legacy bad rows.
ALTER TABLE "master_orders"
  ADD CONSTRAINT "chk_claim_consistency" CHECK (
    (
      "claimed_by_admin_id" IS NULL
      AND "claimed_at"      IS NULL
      AND "claim_expires_at" IS NULL
    )
    OR (
      "claimed_by_admin_id" IS NOT NULL
      AND "claimed_at"      IS NOT NULL
      AND "claim_expires_at" IS NOT NULL
      AND "claim_expires_at" > "claimed_at"
    )
  ) NOT VALID;
