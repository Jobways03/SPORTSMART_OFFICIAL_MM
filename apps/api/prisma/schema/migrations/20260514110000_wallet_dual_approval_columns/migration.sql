-- Phase 13 GST — Wallet dual-approval state machine (Approach B).
-- Adds the intermediate FIRST_APPROVED status and a pair of audit columns
-- to record the first-approver. Both columns are nullable so existing rows
-- (single-approval and pre-feature) don't need a backfill.

ALTER TYPE "WalletAdjustmentStatus" ADD VALUE IF NOT EXISTS 'FIRST_APPROVED' BEFORE 'APPROVED';

ALTER TABLE "wallet_adjustments"
  ADD COLUMN "first_approved_by_admin_id" TEXT,
  ADD COLUMN "first_approved_at"          TIMESTAMP(3);
