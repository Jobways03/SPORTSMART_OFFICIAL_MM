-- Phase 87 (2026-05-23) — NDR/RTO audit Gap #9.
--
-- Extend LedgerSourceType with RTO so the commission reversal
-- handler can distinguish RTO-driven claw-backs from Return-driven
-- ones on the same sub-order. Its own migration because Postgres
-- prohibits ALTER TYPE ADD VALUE in a shared-tx migration.

ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'RTO';
