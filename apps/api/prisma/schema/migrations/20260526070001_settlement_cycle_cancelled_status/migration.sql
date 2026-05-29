-- Phase 141 — add CANCELLED to the settlement-cycle status enum. Isolated in
-- its own migration: ALTER TYPE ... ADD VALUE must not share a transaction with
-- statements that USE the new value (Postgres restriction). This migration only
-- ADDs it; cancelCycle uses it later, in a separate transaction.
ALTER TYPE "SettlementCycleStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
