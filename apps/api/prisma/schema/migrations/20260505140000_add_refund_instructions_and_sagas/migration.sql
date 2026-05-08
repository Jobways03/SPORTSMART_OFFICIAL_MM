-- Phase 3 — Unified Refund System (ADR-009).
-- Schema-only PR (PR 3.1). No code path activates yet; the saga
-- executor and instruction creator land in PRs 3.3-3.4.

-- CreateEnum
CREATE TYPE "RefundSourceType" AS ENUM (
  'RETURN', 'DISPUTE', 'GOODWILL', 'MANUAL', 'REPLACEMENT'
);

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM (
  'ORIGINAL_PAYMENT', 'WALLET', 'BANK_TRANSFER', 'UPI', 'COUPON', 'MANUAL'
);

-- CreateEnum
CREATE TYPE "RefundInstructionStatus" AS ENUM (
  'PENDING_APPROVAL', 'APPROVED', 'PROCESSING',
  'SUCCESS', 'FAILED', 'RETRYING', 'MANUAL_REQUIRED', 'CANCELLED'
);

-- CreateEnum
CREATE TYPE "RefundSagaStatus" AS ENUM (
  'STARTED', 'IN_PROGRESS', 'COMPLETED', 'COMPENSATING', 'FAILED'
);

-- CreateTable: refund_instructions
CREATE TABLE "refund_instructions" (
    "id"                    TEXT NOT NULL,
    "source_type"           "RefundSourceType" NOT NULL,
    "source_id"             TEXT NOT NULL,
    "customer_id"           TEXT NOT NULL,
    "order_id"              TEXT,
    "amount_in_paise"       BIGINT NOT NULL,
    "currency"              TEXT NOT NULL DEFAULT 'INR',
    "refund_method"         "RefundMethod" NOT NULL,
    "status"                "RefundInstructionStatus" NOT NULL DEFAULT 'APPROVED',
    "idempotency_key"       TEXT,
    "gateway_refund_id"     TEXT,
    "wallet_transaction_id" TEXT,
    "failure_reason"        TEXT,
    "attempts"              INTEGER NOT NULL DEFAULT 0,
    "approved_by"           TEXT,
    "approved_at"           TIMESTAMP(3),
    "processed_at"          TIMESTAMP(3),
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_instructions_idempotency_key_key"
  ON "refund_instructions"("idempotency_key");

CREATE INDEX "refund_instructions_source_type_source_id_idx"
  ON "refund_instructions"("source_type", "source_id");
CREATE INDEX "refund_instructions_customer_id_idx"
  ON "refund_instructions"("customer_id");
CREATE INDEX "refund_instructions_status_idx"
  ON "refund_instructions"("status");
CREATE INDEX "refund_instructions_status_processed_at_idx"
  ON "refund_instructions"("status", "processed_at");

-- CreateTable: refund_sagas
CREATE TABLE "refund_sagas" (
    "id"              TEXT NOT NULL,
    "refund_type"     "RefundSourceType" NOT NULL,
    "source_id"       TEXT NOT NULL,
    "instruction_id"  TEXT,
    "amount_in_paise" BIGINT NOT NULL,
    "customer_id"     TEXT NOT NULL,
    "status"          "RefundSagaStatus" NOT NULL DEFAULT 'STARTED',
    "steps"           JSONB NOT NULL,
    "compensations"   JSONB,
    "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"    TIMESTAMP(3),
    "failure_reason"  TEXT,

    CONSTRAINT "refund_sagas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refund_sagas_status_started_at_idx"
  ON "refund_sagas"("status", "started_at");
CREATE INDEX "refund_sagas_source_id_idx"
  ON "refund_sagas"("source_id");
CREATE INDEX "refund_sagas_instruction_id_idx"
  ON "refund_sagas"("instruction_id");
