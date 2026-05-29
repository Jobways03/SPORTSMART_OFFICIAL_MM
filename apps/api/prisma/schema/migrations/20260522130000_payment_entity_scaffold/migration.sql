-- Phase 70 (2026-05-22) — Phase 66 audit Gap #3 + Gap #10,
--                          Phase 67 audit Gap #4.
--
-- Payment entity scaffolding. Shadow table populated alongside
-- the existing MasterOrder.razorpay* + paymentStatus columns so
-- the data starts accumulating now; a future-phase refactor can
-- pivot the read-side to Payment without a data migration.

CREATE TYPE "PaymentLifecycleStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'VOIDED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "PaymentLifecycleMethod" AS ENUM (
  'COD',
  'ONLINE',
  'WALLET_ONLY'
);

CREATE TABLE "payments" (
  "id"                   TEXT PRIMARY KEY,
  "master_order_id"      TEXT NOT NULL,
  "method"               "PaymentLifecycleMethod" NOT NULL,
  "status"               "PaymentLifecycleStatus" NOT NULL DEFAULT 'CREATED',
  "amount_in_paise"      BIGINT NOT NULL,
  "currency"             TEXT NOT NULL DEFAULT 'INR',
  "provider"             TEXT NOT NULL DEFAULT 'razorpay',
  "provider_order_id"    TEXT,
  "provider_payment_id"  TEXT,
  "idempotency_key"      TEXT,
  "expires_at"           TIMESTAMP,
  "captured_at"          TIMESTAMP,
  "terminal_at"          TIMESTAMP,
  "created_at"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "payments_master_order_id_idx" ON "payments" ("master_order_id");
CREATE INDEX "payments_provider_order_id_idx" ON "payments" ("provider_order_id");
CREATE INDEX "payments_provider_payment_id_idx" ON "payments" ("provider_payment_id");
CREATE INDEX "payments_status_created_at_idx" ON "payments" ("status", "created_at" DESC);

-- Partial unique on providerOrderId — mirrors the Phase 66 MasterOrder
-- partial unique. Prevents two Payment rows from sharing a gateway order id.
CREATE UNIQUE INDEX "payments_provider_order_id_unique"
  ON "payments" ("provider_order_id")
  WHERE "provider_order_id" IS NOT NULL;
