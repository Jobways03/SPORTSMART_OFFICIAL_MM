-- Phase 159 (2026-05-26) — Affiliate Commission Rate audit.
--   - commission_percentage_updated_by_id / _at: denormalised last-changer.
--   - affiliate_commission_rate_history: append-only rate-change trail
--     (audit Critical #3 — only affiliates.updatedAt existed before).

ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "commission_percentage_updated_by_id" TEXT;
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "commission_percentage_updated_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "affiliate_commission_rate_history" (
  "id" TEXT NOT NULL,
  "affiliate_id" TEXT NOT NULL,
  "from_rate" DECIMAL(5,2),
  "to_rate" DECIMAL(5,2),
  "changed_by_admin_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_commission_rate_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "affiliate_commission_rate_history_affiliate_id_created_at_idx"
  ON "affiliate_commission_rate_history" ("affiliate_id", "created_at");

ALTER TABLE "affiliate_commission_rate_history"
  ADD CONSTRAINT "affiliate_commission_rate_history_affiliate_id_fkey"
  FOREIGN KEY ("affiliate_id") REFERENCES "affiliates" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
