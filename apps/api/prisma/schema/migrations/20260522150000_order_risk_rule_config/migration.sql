-- Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12 + #17.
--
-- Per-rule tunable weights / thresholds. Rule LOGIC stays in code;
-- only WEIGHTS and a JSON flag bag of THRESHOLDS come from this
-- table. Allows ops to tune without redeploy.

CREATE TABLE "order_risk_rule_configs" (
  "id"            TEXT PRIMARY KEY,
  "reason_code"   "OrderRiskReasonCode" NOT NULL UNIQUE,
  "score_delta"   INTEGER NOT NULL,
  "config"        JSONB NOT NULL DEFAULT '{}',
  "enabled"       BOOLEAN NOT NULL DEFAULT TRUE,
  "mask_amounts"  BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_at"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_by"    TEXT
);

-- Seed initial rows mirroring the in-code defaults. A fresh
-- deploy without this seed still works (the service falls back
-- to hardcoded defaults when a row is missing); this gives ops
-- something to read + edit on day 1.
INSERT INTO "order_risk_rule_configs" ("id", "reason_code", "score_delta", "config") VALUES
  (gen_random_uuid()::text, 'FIRST_TIME_CUSTOMER', 5,    '{}'::jsonb),
  (gen_random_uuid()::text, 'REPEAT_CUSTOMER',     -10,  '{}'::jsonb),
  (gen_random_uuid()::text, 'COD_PAYMENT',         5,    '{}'::jsonb),
  (gen_random_uuid()::text, 'ONLINE_CAPTURED',     -5,   '{}'::jsonb),
  (gen_random_uuid()::text, 'ONLINE_NOT_CAPTURED', 10,   '{}'::jsonb),
  (gen_random_uuid()::text, 'HIGH_VALUE',          10,   '{"valueRupees": 10000}'::jsonb),
  (gen_random_uuid()::text, 'VERY_HIGH_VALUE',     20,   '{"valueRupees": 25000}'::jsonb),
  (gen_random_uuid()::text, 'BULK_ORDER',          5,    '{"itemThreshold": 10}'::jsonb),
  (gen_random_uuid()::text, 'PINCODE_RTO',         10,   '{"pincodes": []}'::jsonb),
  (gen_random_uuid()::text, 'CANCELLATION_HISTORY', 15,  '{"minPrior": 3, "lookbackDays": 90, "rateThreshold": 0.3}'::jsonb),
  (gen_random_uuid()::text, 'SUSPICIOUS_EMAIL',    10,   '{"domains": ["mailinator.com", "guerrillamail.com", "tempmail.com", "10minutemail.com", "yopmail.com", "throwawaymail.com", "getnada.com", "sharklasers.com", "maildrop.cc", "fake-mail.net"]}'::jsonb),
  (gen_random_uuid()::text, 'VELOCITY',            10,   '{"windowMinutes": 60, "threshold": 3}'::jsonb)
ON CONFLICT ("reason_code") DO NOTHING;
