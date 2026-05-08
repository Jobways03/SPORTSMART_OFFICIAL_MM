-- ============================================
-- Phase 5 (PR 5.5) — customer_abuse_counters
-- ============================================
-- Rolling 90-day return-rate aggregates per customer. Read by the
-- return-creation hot path to decide between auto-approval and
-- mandatory manual review.

CREATE TABLE "customer_abuse_counters" (
    "customer_id"               TEXT         NOT NULL,
    "window_start"              TIMESTAMP(3) NOT NULL,
    "window_end"                TIMESTAMP(3) NOT NULL,
    "orders_last_90d"           INTEGER      NOT NULL DEFAULT 0,
    "returns_last_90d"          INTEGER      NOT NULL DEFAULT 0,
    "disputes_last_90d"         INTEGER      NOT NULL DEFAULT 0,
    "return_rate_bps"           INTEGER,
    "requires_manual_approval"  BOOLEAN      NOT NULL DEFAULT false,
    "flag_reason"               TEXT,
    "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_abuse_counters_pkey" PRIMARY KEY ("customer_id")
);

CREATE INDEX "customer_abuse_counters_requires_manual_approval_idx"
    ON "customer_abuse_counters" ("requires_manual_approval");

CREATE INDEX "customer_abuse_counters_return_rate_bps_idx"
    ON "customer_abuse_counters" ("return_rate_bps");
