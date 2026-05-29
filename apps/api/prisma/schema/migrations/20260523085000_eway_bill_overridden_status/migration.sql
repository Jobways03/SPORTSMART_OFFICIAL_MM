-- Phase 89 (2026-05-23) — Gap #8.
--
-- Extend EWayBillStatus with OVERRIDDEN. Postgres prohibits
-- ALTER TYPE ADD VALUE in a shared-tx migration, so this lives in
-- its own migration ahead of the 090000 EWB hardening migration.

ALTER TYPE "EWayBillStatus" ADD VALUE IF NOT EXISTS 'OVERRIDDEN';
