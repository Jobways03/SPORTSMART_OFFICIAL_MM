-- Phase 154 (2026-05-26) — Affiliate Payout Request hardening.
--   - Immutable payout-method snapshot (method-as-of-request-time) + denorm type.
--   - Admin-rejection columns.
--   - Append-only status-history table.
--   - Partial unique: at most ONE active payout request per affiliate (DB-level
--     backstop for the commission-claim race, regardless of code).

ALTER TABLE "affiliate_payout_requests"
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "payout_method_type" TEXT,
  ADD COLUMN IF NOT EXISTS "payout_method_snapshot" JSONB;

CREATE TABLE "affiliate_payout_request_status_history" (
  "id"                    TEXT NOT NULL,
  "payout_request_id"     TEXT NOT NULL,
  "from_status"           TEXT,
  "to_status"             TEXT NOT NULL,
  "changed_by_actor_type" TEXT NOT NULL,
  "changed_by_actor_id"   TEXT,
  "reason"                TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_payout_request_status_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "affiliate_payout_request_status_history"
  ADD CONSTRAINT "affiliate_payout_request_status_history_request_fkey"
  FOREIGN KEY ("payout_request_id") REFERENCES "affiliate_payout_requests" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "affiliate_payout_request_status_history_request_created_idx"
  ON "affiliate_payout_request_status_history" ("payout_request_id", "created_at");

-- One active request per affiliate (REQUESTED / APPROVED / PROCESSING).
CREATE UNIQUE INDEX "affiliate_active_payout_request"
  ON "affiliate_payout_requests" ("affiliate_id")
  WHERE "status" IN ('REQUESTED', 'APPROVED', 'PROCESSING');
