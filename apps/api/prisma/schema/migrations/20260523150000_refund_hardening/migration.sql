-- Phase 96 (2026-05-23) — Phase 98 + 99 audit closures.
--
-- 1) RefundTransaction unique on (return_id, attempt_number)
--    Phase 98 audit Gap #17 — manual retries left duplicate INITIATED
--    rows in the audit table for what is actually a single
--    gateway-idempotent refund.
--
-- 2) RefundSaga unique on instruction_id + idempotency_key column
--    Phase 99 audit Gap #11 / Gap #15 — two concurrent
--    runSagaForInstruction calls could spawn duplicate saga rows.
--    The instruction-level idempotencyKey is the single canonical
--    refund identity; we mirror it onto the saga so the lookup is
--    direct.
--
-- 3) Razorpay refund event audit table
--    Phase 98 audit Gap #21 — async webhook arrivals need an idempotent
--    landing zone before applying state changes.

-- ── 1) RefundTransaction dedup ───────────────────────────────────
-- Existing rows may violate the unique if a manual retry has already
-- written duplicates. Drop conflicting duplicates first.
DELETE FROM refund_transactions a USING refund_transactions b
WHERE a.id > b.id
  AND a.return_id = b.return_id
  AND a.attempt_number = b.attempt_number;

CREATE UNIQUE INDEX IF NOT EXISTS "refund_transactions_return_id_attempt_number_key"
  ON "refund_transactions" ("return_id", "attempt_number");

-- ── 2) RefundSaga idempotency + dedup ────────────────────────────
ALTER TABLE "refund_sagas"
  ADD COLUMN IF NOT EXISTS "idempotency_key"        TEXT,
  ADD COLUMN IF NOT EXISTS "wallet_transaction_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "gateway_refund_id"      TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "refund_sagas_idempotency_key_key"
  ON "refund_sagas" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- Sparse unique on instruction_id so one instruction maps to at most
-- one saga at a time. Drop existing duplicates first.
DELETE FROM refund_sagas a USING refund_sagas b
WHERE a.id > b.id
  AND a.instruction_id IS NOT NULL
  AND a.instruction_id = b.instruction_id;

CREATE UNIQUE INDEX IF NOT EXISTS "refund_sagas_instruction_id_key"
  ON "refund_sagas" ("instruction_id")
  WHERE "instruction_id" IS NOT NULL;

-- New saga states (Phase 99 Gap #9 / #18 — distinguishing terminals).
ALTER TYPE "RefundSagaStatus" ADD VALUE IF NOT EXISTS 'COMPENSATED';
ALTER TYPE "RefundSagaStatus" ADD VALUE IF NOT EXISTS 'COMPENSATION_FAILED';

-- ── 3) Razorpay refund webhook events ────────────────────────────
-- Idempotent landing for inbound webhook payloads (event_id is
-- Razorpay's evt_xxxxxx identifier; we refuse to process the same
-- one twice). Status payload retained for forensic replay.
CREATE TABLE IF NOT EXISTS "razorpay_refund_webhook_events" (
  "id"             TEXT PRIMARY KEY,
  "event_id"       TEXT NOT NULL UNIQUE,
  "event_type"     TEXT NOT NULL,
  "refund_id"      TEXT,
  "payment_id"     TEXT,
  "raw_payload"    JSONB NOT NULL,
  "processed_at"   TIMESTAMP(3),
  "processed_outcome" TEXT,
  "received_at"    TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "razorpay_refund_webhook_events_refund_id_idx"
  ON "razorpay_refund_webhook_events" ("refund_id");
CREATE INDEX IF NOT EXISTS "razorpay_refund_webhook_events_received_at_idx"
  ON "razorpay_refund_webhook_events" ("received_at" DESC);
