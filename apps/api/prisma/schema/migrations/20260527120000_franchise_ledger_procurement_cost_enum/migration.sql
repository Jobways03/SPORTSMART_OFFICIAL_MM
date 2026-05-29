-- Phase 159p (2026-05-27) — Franchise Procurement Request Flow audit #8.
-- Add PROCUREMENT_COST to FranchiseLedgerSource so the principal (landed) cost
-- of a settled procurement can be posted as a franchise→HQ payable, distinct
-- from the existing PROCUREMENT_FEE. Isolated in its own migration because
-- `ALTER TYPE ... ADD VALUE` has transaction-block constraints on older
-- PostgreSQL. Idempotent via IF NOT EXISTS.

ALTER TYPE "FranchiseLedgerSource" ADD VALUE IF NOT EXISTS 'PROCUREMENT_COST';
