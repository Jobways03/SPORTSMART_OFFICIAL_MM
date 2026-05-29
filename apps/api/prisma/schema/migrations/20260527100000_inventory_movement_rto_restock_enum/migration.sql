-- Phase 159o (2026-05-27) — Franchise Inventory Flow audit #12.
-- Add RTO_RESTOCK to InventoryMovementType so a courier Return-To-Origin
-- (an undelivered shipment coming back to the franchise) can be journaled
-- distinctly from a customer-initiated ORDER_RETURN. Kept in its own
-- migration because `ALTER TYPE ... ADD VALUE` has transaction-block
-- constraints on older PostgreSQL; isolating it avoids any interaction with
-- other DDL. `IF NOT EXISTS` makes it idempotent.

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'RTO_RESTOCK';
