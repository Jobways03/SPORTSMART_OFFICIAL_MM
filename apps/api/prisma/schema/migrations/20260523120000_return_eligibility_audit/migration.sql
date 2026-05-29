-- Phase 92 follow-up (2026-05-23) — Gap #21 chain of custody on
-- eligibility checks.

CREATE TABLE "return_eligibility_audits" (
  "id"               TEXT PRIMARY KEY,
  "master_order_id"  TEXT NOT NULL,
  "customer_id"      TEXT NOT NULL,
  "ip_address"       TEXT,
  "user_agent"       TEXT,
  "result_eligible"  BOOLEAN NOT NULL,
  "result_reason"    TEXT,
  "item_count"       INTEGER NOT NULL DEFAULT 0,
  "eligible_count"   INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "return_eligibility_audits_master_order_id_created_at_idx"
  ON "return_eligibility_audits" ("master_order_id", "created_at" DESC);
CREATE INDEX "return_eligibility_audits_customer_id_created_at_idx"
  ON "return_eligibility_audits" ("customer_id", "created_at");
