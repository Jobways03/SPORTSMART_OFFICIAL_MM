-- Option B (deferred order creation) — Phase 4.
-- Additive only: poll-backoff timestamp for the deferred-capture recovery cron.

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN "last_polled_at" TIMESTAMP(3);
