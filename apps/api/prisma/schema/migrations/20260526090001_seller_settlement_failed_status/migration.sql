-- Phase 145 — FAILED resting state for a payout the bank rejected/reversed, so
-- it can be retried (FAILED → PAID) with an audit chain. Isolated migration
-- (ALTER TYPE ... ADD VALUE must not share a txn with statements using it).
ALTER TYPE "SellerSettlementStatus" ADD VALUE IF NOT EXISTS 'FAILED';
