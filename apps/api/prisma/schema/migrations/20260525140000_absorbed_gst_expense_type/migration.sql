-- Phase 109 (2026-05-25) — book absorbed GST on time-barred returns.
--
-- When a return's Section 34 credit-note window has closed, the platform can
-- no longer reclaim the GST via a credit note. On approval of the
-- TIME_BARRED_CREDIT_NOTE wallet adjustment, the absorbed GST is recorded as a
-- PlatformExpense(ABSORBED_GST) for GSTR reconciliation. Not referenced by any
-- statement in this migration, so the Postgres "new enum value cannot be used
-- in the same transaction" rule is not triggered.

ALTER TYPE "PlatformExpenseType" ADD VALUE 'ABSORBED_GST';
