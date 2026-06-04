-- Phase 169 — Payment Ops Dashboard audit remediation.
--
-- Adds the Chargeback (Razorpay dispute) model, mismatch-alert provenance
-- columns, a CHARGEBACK_EVIDENCE_DUE admin-task kind, and a uniqueness guard +
-- index on payment attempts.

-- ── #13: mismatch-alert provenance enum + new admin-task kind ────────────────
CREATE TYPE "PaymentMismatchSource" AS ENUM (
  'WEBHOOK', 'POLLER', 'CHECKOUT_VERIFY', 'RECONCILIATION', 'MANUAL', 'SYSTEM'
);
ALTER TYPE "AdminTaskKind" ADD VALUE IF NOT EXISTS 'CHARGEBACK_EVIDENCE_DUE';

-- ── #1/#2: chargeback lifecycle enums ───────────────────────────────────────
CREATE TYPE "ChargebackStatus" AS ENUM (
  'OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED'
);
CREATE TYPE "ChargebackEvidenceStatus" AS ENUM (
  'NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'EXPIRED'
);
CREATE TYPE "ChargebackFinancialImpact" AS ENUM (
  'HELD', 'RECOVERED', 'LOST', 'NONE'
);

-- ── #6-provider / #13: provenance columns on payment_mismatch_alerts ─────────
ALTER TABLE "payment_mismatch_alerts"
  ADD COLUMN IF NOT EXISTS "provider"       TEXT NOT NULL DEFAULT 'razorpay',
  ADD COLUMN IF NOT EXISTS "source_type"    "PaymentMismatchSource" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "source_context" JSONB;

-- ── race section: dedup attempts + #3 failed-payments index ──────────────────
-- Two concurrent attempts for the same (order, kind) computed the same
-- COUNT-based attemptNumber. Partial unique (NULL master_order_id exempt).
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_order_kind_attempt_unique"
  ON "payment_attempts"("master_order_id", "kind", "attempt_number")
  WHERE "master_order_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "payment_attempts_status_kind_created_idx"
  ON "payment_attempts"("status", "kind", "created_at" DESC);

-- ── #1/#2: chargebacks table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chargebacks" (
  "id"                    TEXT NOT NULL,
  "provider"              TEXT NOT NULL DEFAULT 'razorpay',
  "provider_dispute_id"   TEXT NOT NULL,
  "provider_payment_id"   TEXT,
  "master_order_id"       TEXT,
  "order_number"          TEXT,
  "customer_id"           TEXT,
  "reason_code"           TEXT,
  "status"                "ChargebackStatus" NOT NULL DEFAULT 'OPEN',
  "amount_in_paise"       BIGINT NOT NULL,
  "currency"              TEXT NOT NULL DEFAULT 'INR',
  "due_date"              TIMESTAMP(3),
  "evidence_status"       "ChargebackEvidenceStatus" NOT NULL DEFAULT 'PENDING',
  "financial_impact"      "ChargebackFinancialImpact" NOT NULL DEFAULT 'HELD',
  "evidence_submitted_at" TIMESTAMP(3),
  "evidence_submitted_by" TEXT,
  "evidence_notes"        TEXT,
  "raw_payload"           JSONB,
  "resolved_at"           TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chargebacks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chargebacks_provider_dispute_id_key"
  ON "chargebacks"("provider_dispute_id");
CREATE INDEX IF NOT EXISTS "chargebacks_status_due_date_idx"          ON "chargebacks"("status", "due_date");
CREATE INDEX IF NOT EXISTS "chargebacks_provider_payment_id_idx"      ON "chargebacks"("provider_payment_id");
CREATE INDEX IF NOT EXISTS "chargebacks_master_order_id_idx"          ON "chargebacks"("master_order_id");
CREATE INDEX IF NOT EXISTS "chargebacks_evidence_status_due_date_idx" ON "chargebacks"("evidence_status", "due_date");
