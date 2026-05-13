-- Phase 1 (PR 1.11) — persistent cursor table for outgoing integration pollers.
--
-- Each row is the last-successful-poll timestamp for one named poller.
-- Single-row-per-poller table; lookups go through the primary key.
-- The iThink tracking poller is the first consumer; future pollers
-- (Razorpay status, settlement reconciliation, etc.) live as parallel
-- rows under their own poller_key.

CREATE TABLE "integration_poller_checkpoints" (
  "poller_key"      TEXT NOT NULL,
  "last_polled_at"  TIMESTAMP(3) NOT NULL,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_poller_checkpoints_pkey" PRIMARY KEY ("poller_key")
);
