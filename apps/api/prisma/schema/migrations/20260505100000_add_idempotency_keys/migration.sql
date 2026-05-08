-- Phase 1.1 — Idempotency keys.
-- Backed by ADR-010. Read docs/decisions/ADR-010-idempotency-keys.md
-- before changing this migration. Behaviour off by default until
-- IDEMPOTENCY_ENABLED=true is set in the environment.

-- CreateEnum
CREATE TYPE "IdempotencyKeyState" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id"              TEXT NOT NULL,
    "key"             TEXT NOT NULL,
    "actor_type"      TEXT NOT NULL,
    "actor_id"        TEXT NOT NULL,
    "endpoint"        TEXT NOT NULL,
    "request_hash"    TEXT NOT NULL,
    "state"           "IdempotencyKeyState" NOT NULL DEFAULT 'PENDING',
    "response_status" INTEGER,
    "response_body"   JSONB,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"    TIMESTAMP(3),
    "expires_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_state_created_at_idx" ON "idempotency_keys"("state", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_actor_type_actor_id_idx" ON "idempotency_keys"("actor_type", "actor_id");
