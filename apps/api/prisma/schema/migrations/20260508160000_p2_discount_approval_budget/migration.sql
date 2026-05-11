-- Phase F (P2) — Discount approval workflow + budget enforcement.
--
-- Two related changes:
--
--   1. Approval workflow: new DiscountStatus values PENDING_APPROVAL
--      and REJECTED, plus tracking columns for who-approved/rejected
--      and why. High-value discounts (above a configurable threshold)
--      are routed through approval before going live.
--
--   2. Budget enforcement: budget_total_paise + budget_mode columns
--      let admins cap total spend on a discount. HARD_STOP refuses
--      new reservations once the cap is hit; SOFT_ALERT only warns.
--      budget_spent_paise is a denormalized cache populated from the
--      liability ledger and refreshed by the reservation service on
--      each redemption — accurate enough for the reservation gate
--      since the ledger is the source of truth.

-- 1. Extend the DiscountStatus enum (PG enum ALTER is non-transactional
--    so we run it first; later DDL inside the same migration depends
--    on these values existing).
ALTER TYPE "DiscountStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "DiscountStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- 2. Budget mode enum.
DO $$ BEGIN
  CREATE TYPE "DiscountBudgetMode" AS ENUM ('HARD_STOP', 'SOFT_ALERT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Approval + budget columns.
ALTER TABLE "discounts"
  ADD COLUMN IF NOT EXISTS "requires_approval"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "approved_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejection_reason"   TEXT,
  ADD COLUMN IF NOT EXISTS "budget_total_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "budget_spent_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "budget_mode"        "DiscountBudgetMode";

-- 4. Index for the approval-queue view (admins filter status=PENDING_APPROVAL).
CREATE INDEX IF NOT EXISTS "discounts_status_idx" ON "discounts" ("status");
