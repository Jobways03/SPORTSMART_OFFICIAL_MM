-- Phase 90 (2026-05-23) — Gap #8/#17.
-- Extend EInvoiceStatus with CANCELLED. Own migration because
-- Postgres prohibits ALTER TYPE ADD VALUE inside the same tx as
-- other DDL.

ALTER TYPE "EInvoiceStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
