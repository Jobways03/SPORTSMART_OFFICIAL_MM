-- Phase 135 — commission processor hardening: processing provenance + DLQ.

-- Provenance + numeric rate on each commission record.
ALTER TABLE "commission_records" ADD COLUMN "processed_at" TIMESTAMP(3);
ALTER TABLE "commission_records" ADD COLUMN "processed_by" TEXT;
ALTER TABLE "commission_records" ADD COLUMN "commission_rate_bps" INTEGER;

-- Dead-letter queue: a sub-order whose commission computation throws is
-- recorded here (one row per sub-order) instead of wedging the cron tick.
CREATE TABLE "commission_failures" (
  "id"           TEXT NOT NULL,
  "sub_order_id" TEXT NOT NULL,
  "trigger"      TEXT NOT NULL,
  "error"        TEXT NOT NULL,
  "attempts"     INTEGER NOT NULL DEFAULT 1,
  "resolved_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_failures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commission_failures_sub_order_id_key" ON "commission_failures"("sub_order_id");
CREATE INDEX "commission_failures_resolved_at_idx" ON "commission_failures"("resolved_at");
CREATE INDEX "commission_failures_created_at_idx" ON "commission_failures"("created_at");
