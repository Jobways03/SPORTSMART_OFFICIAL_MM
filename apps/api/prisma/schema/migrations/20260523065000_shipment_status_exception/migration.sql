-- Phase 87 (2026-05-23) — NDR/RTO Gap #10.
--
-- Extend shipment_internal_status_enum with EXCEPTION. Postgres
-- prohibits `ALTER TYPE ... ADD VALUE` inside a transaction shared
-- with other DDL, so this lives in its own migration ahead of the
-- 070000 NDR/RTO lifecycle migration which depends on the enum.

ALTER TYPE "shipment_internal_status_enum" ADD VALUE IF NOT EXISTS 'EXCEPTION';
