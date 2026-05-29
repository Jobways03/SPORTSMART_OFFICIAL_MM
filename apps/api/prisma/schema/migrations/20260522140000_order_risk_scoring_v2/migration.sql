-- Phase 71 (2026-05-22) — Order Risk Scoring hardening.
-- Closes Phase-70 risk audit Gaps #7 (enum band), #8 (history),
-- #9 (scoredBy + source), #10 (score version).

-- ── 1. Enums ────────────────────────────────────────────────
CREATE TYPE "OrderRiskBand" AS ENUM ('GREEN', 'YELLOW', 'RED');
CREATE TYPE "OrderRiskScoreSource" AS ENUM ('RULES', 'MANUAL');

-- Fixed 2026-05-26: OrderRiskReasonCode was ALTER-ed below ("ADD VALUE") but
-- never CREATE-d by any migration (the original CREATE was applied via db
-- push / migrate dev and never committed), so this migration failed on a clean
-- DB with "type OrderRiskReasonCode does not exist". Create it here with the
-- full value set from orders.prisma so the subsequent ADD VALUE IF NOT EXISTS
-- statements become no-ops and the DB matches the schema exactly.
CREATE TYPE "OrderRiskReasonCode" AS ENUM (
  'FIRST_TIME_CUSTOMER',
  'REPEAT_CUSTOMER',
  'COD_PAYMENT',
  'ONLINE_CAPTURED',
  'ONLINE_NOT_CAPTURED',
  'VERY_HIGH_VALUE',
  'HIGH_VALUE',
  'BULK_ORDER',
  'PINCODE_RTO',
  'CANCELLATION_HISTORY',
  'SUSPICIOUS_EMAIL',
  'VELOCITY',
  'OTHER'
);

-- ── 2. MasterOrder columns ─────────────────────────────────
-- New columns first (additive; safe).
ALTER TABLE "master_orders"
  ADD COLUMN "verification_scored_by"      TEXT,
  ADD COLUMN "verification_score_source"   "OrderRiskScoreSource",
  ADD COLUMN "verification_score_version"  INTEGER NOT NULL DEFAULT 1;

-- Convert verificationRiskBand TEXT → OrderRiskBand enum.
-- Two-step swap: rename old, add new column, backfill (UPPER +
-- IN-list filter), drop old. UPPER guards against pre-Phase-71
-- typos already in the table.
ALTER TABLE "master_orders"
  RENAME COLUMN "verification_risk_band" TO "verification_risk_band_legacy";

ALTER TABLE "master_orders"
  ADD COLUMN "verification_risk_band" "OrderRiskBand";

UPDATE "master_orders"
SET    "verification_risk_band" = CASE
         WHEN UPPER("verification_risk_band_legacy") = 'GREEN'  THEN 'GREEN'::"OrderRiskBand"
         WHEN UPPER("verification_risk_band_legacy") = 'YELLOW' THEN 'YELLOW'::"OrderRiskBand"
         WHEN UPPER("verification_risk_band_legacy") = 'RED'    THEN 'RED'::"OrderRiskBand"
         ELSE NULL
       END
WHERE  "verification_risk_band_legacy" IS NOT NULL;

ALTER TABLE "master_orders"
  DROP COLUMN "verification_risk_band_legacy";

-- ── 3. Composite index for bulk-approve filter ─────────────
CREATE INDEX "master_orders_order_status_risk_band_created_at_idx"
  ON "master_orders" ("order_status", "verification_risk_band", "created_at");

-- ── 3b. OrderRiskReasonCode enum extension ────────────────
-- Phase 71 audit Gap #11 — add the four new fraud-signal codes.
-- IF NOT EXISTS guards an already-deployed environment from
-- re-adding values.
ALTER TYPE "OrderRiskReasonCode" ADD VALUE IF NOT EXISTS 'PINCODE_RTO';
ALTER TYPE "OrderRiskReasonCode" ADD VALUE IF NOT EXISTS 'CANCELLATION_HISTORY';
ALTER TYPE "OrderRiskReasonCode" ADD VALUE IF NOT EXISTS 'SUSPICIOUS_EMAIL';
ALTER TYPE "OrderRiskReasonCode" ADD VALUE IF NOT EXISTS 'VELOCITY';

-- ── 4. OrderRiskScoreHistory ───────────────────────────────
CREATE TABLE "order_risk_score_history" (
  "id"              TEXT PRIMARY KEY,
  "master_order_id" TEXT NOT NULL,
  "score"           INTEGER NOT NULL,
  "band"            "OrderRiskBand" NOT NULL,
  "reasons"         JSONB NOT NULL,
  "source"          "OrderRiskScoreSource" NOT NULL,
  "scored_at"       TIMESTAMP NOT NULL DEFAULT NOW(),
  "scored_by"       TEXT,
  "scorer_version"  INTEGER NOT NULL,
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders" ("id") ON DELETE CASCADE
);

CREATE INDEX "order_risk_score_history_master_order_id_idx"
  ON "order_risk_score_history" ("master_order_id", "scored_at" DESC);

CREATE INDEX "order_risk_score_history_band_idx"
  ON "order_risk_score_history" ("band", "scored_at" DESC);
