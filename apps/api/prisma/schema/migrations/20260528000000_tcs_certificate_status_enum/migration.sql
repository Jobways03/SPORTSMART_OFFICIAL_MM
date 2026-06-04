-- Phase 160 (§52 TCS lifecycle audit — B1).
--
-- Extend TcsStatus with CERTIFICATE_ISSUED, the terminal stage of the
-- §52 lifecycle (operator furnishes the TCS certificate to the supplier
-- per GST §52(5) within 5 days of GSTR-8 filing).
--
-- Lives in its OWN migration because PostgreSQL prohibits
-- `ALTER TYPE ... ADD VALUE` in the same transaction as other DDL, and
-- the new value cannot be referenced until the adding transaction has
-- committed. The columns + new event table that USE this value land in
-- the 010000 migration that runs after this one.

ALTER TYPE "TcsStatus" ADD VALUE IF NOT EXISTS 'CERTIFICATE_ISSUED';
