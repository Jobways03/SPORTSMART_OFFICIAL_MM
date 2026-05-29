-- Phase 150 (2026-05-26) — Post-Settlement Reversal netting.
-- New SettlementAdjustmentType value used by createCycle when it consumes a
-- PENDING SellerDebit and nets the claw-back off the seller's payout.
-- Isolated in its own migration: PostgreSQL forbids using a newly-added enum
-- value in the same transaction that adds it, so this must commit before any
-- code (or later migration) references 'CLAWBACK'.
ALTER TYPE "SettlementAdjustmentType" ADD VALUE IF NOT EXISTS 'CLAWBACK';
