-- Phase 160 (E-Way Bill cancel/override flow audit — B1).
--
-- Two-phase cancel states. The cancel path now flips the row to
-- CANCELLATION_PENDING BEFORE calling NIC, so a crash between the provider
-- call and the final DB write leaves a recoverable marker instead of a
-- silent GENERATED↔NIC-cancelled drift. A reconcile cron retries the
-- (idempotent) NIC cancel and settles the row to CANCELLED, or parks it in
-- CANCELLATION_FAILED for ops.
--
-- Own migration: PostgreSQL prohibits ALTER TYPE ... ADD VALUE in the same
-- transaction as DDL that uses the new value. The columns that pair with
-- these states land in the 050000 migration.

ALTER TYPE "EWayBillStatus" ADD VALUE IF NOT EXISTS 'CANCELLATION_PENDING';
ALTER TYPE "EWayBillStatus" ADD VALUE IF NOT EXISTS 'CANCELLATION_FAILED';
