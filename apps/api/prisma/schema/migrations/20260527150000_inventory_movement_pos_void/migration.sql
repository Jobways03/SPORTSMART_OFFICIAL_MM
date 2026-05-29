-- Phase 159r (2026-05-27) — Franchise POS Void/Return audit #8.
-- Add POS_VOID to InventoryMovementType so a void restock is distinguishable
-- from a customer POS_RETURN in the ledger + daily reconciliation. Isolated
-- because ALTER TYPE ... ADD VALUE has transaction-block constraints on older
-- PostgreSQL. Idempotent via IF NOT EXISTS.

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'POS_VOID';
