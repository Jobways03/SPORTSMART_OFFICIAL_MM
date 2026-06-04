-- Phase 178 (#4 follow-up) — complete the SellerSettlementStatus taxonomy.
-- READY_FOR_PAYOUT is set when a settlement is locked into a payout batch;
-- DRAFT is declared for taxonomy completeness (the active draft stage lives on
-- SettlementCycle). Additive enum values only.

ALTER TYPE "SellerSettlementStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PAYOUT';
ALTER TYPE "SellerSettlementStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
