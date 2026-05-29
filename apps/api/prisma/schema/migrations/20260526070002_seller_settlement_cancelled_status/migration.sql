-- Phase 141 — add CANCELLED to the seller-settlement status enum so a cancelled
-- cycle's per-seller settlements can be marked CANCELLED (records released).
-- Isolated migration (ALTER TYPE ... ADD VALUE not used in the same txn).
ALTER TYPE "SellerSettlementStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
