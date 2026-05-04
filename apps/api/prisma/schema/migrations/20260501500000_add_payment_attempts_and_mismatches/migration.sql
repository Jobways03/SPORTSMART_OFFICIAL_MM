-- CreateEnum
CREATE TYPE "PaymentAttemptKind" AS ENUM ('CREATE_ORDER', 'CAPTURE', 'VERIFY_SIGNATURE', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "PaymentMismatchKind" AS ENUM ('AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE_PAYMENT', 'ORPHAN_PAYMENT', 'SIGNATURE_INVALID');

-- CreateEnum
CREATE TYPE "PaymentMismatchStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT,
    "order_number" TEXT,
    "kind" "PaymentAttemptKind" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "provider_refund_id" TEXT,
    "amount_in_paise" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "response_summary" TEXT,
    "failure_reason" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_attempts_master_order_id_kind_created_at_idx" ON "payment_attempts"("master_order_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_attempts_provider_payment_id_idx" ON "payment_attempts"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_attempts_status_created_at_idx" ON "payment_attempts"("status", "created_at" DESC);

-- CreateTable
CREATE TABLE "payment_mismatch_alerts" (
    "id" TEXT NOT NULL,
    "kind" "PaymentMismatchKind" NOT NULL,
    "status" "PaymentMismatchStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 50,
    "master_order_id" TEXT,
    "order_number" TEXT,
    "provider_payment_id" TEXT,
    "expected_in_paise" INTEGER,
    "actual_in_paise" INTEGER,
    "description" TEXT NOT NULL,
    "resolution_notes" TEXT,
    "resolved_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_mismatch_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_mismatch_alerts_status_severity_created_at_idx" ON "payment_mismatch_alerts"("status", "severity" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_mismatch_alerts_master_order_id_idx" ON "payment_mismatch_alerts"("master_order_id");

-- CreateIndex
CREATE INDEX "payment_mismatch_alerts_provider_payment_id_idx" ON "payment_mismatch_alerts"("provider_payment_id");
