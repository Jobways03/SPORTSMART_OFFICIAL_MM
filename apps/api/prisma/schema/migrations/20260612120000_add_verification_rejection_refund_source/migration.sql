-- Phase 258 — add the missing RefundSourceType enum value.
--
-- The Prisma schema (refund-instructions.prisma) declares
-- RefundSourceType.VERIFICATION_REJECTION, but it was never added to the
-- Postgres enum, so OrdersService.rejectOrder's refund insert threw
-- 22P02 ("invalid input value for enum RefundSourceType:
-- VERIFICATION_REJECTION") for every PAID order — silently failing the
-- refund-to-wallet on admin rejection. This backfills the enum value.
ALTER TYPE "RefundSourceType" ADD VALUE IF NOT EXISTS 'VERIFICATION_REJECTION';
