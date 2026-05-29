-- Phase 154 (2026-05-26) — Affiliate Payout Request audit.
-- REJECTED status (admin rejection before approval, distinct from bank FAILED).
-- Isolated: PostgreSQL forbids using a new enum value in the same txn that adds it.
ALTER TYPE "AffiliatePayoutStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
