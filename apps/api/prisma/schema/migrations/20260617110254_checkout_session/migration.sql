-- Option B (deferred order creation) — CheckoutSession.
-- Additive only: new enum + new table. No changes to existing tables.

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('CREATED', 'PAID', 'ORDER_CREATED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'CREATED',
    "payment_method" "OrderPaymentMethod" NOT NULL,
    "address_id" TEXT,
    "shipping_address_snapshot" JSONB NOT NULL,
    "cart_snapshot" JSONB NOT NULL,
    "item_count" INTEGER NOT NULL,
    "total_amount_in_paise" BIGINT NOT NULL,
    "wallet_apply_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gateway_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "coupon_code" TEXT,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "reservation_correlation_id" TEXT,
    "master_order_id" TEXT,
    "order_created_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "refunded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_razorpay_order_id_key" ON "checkout_sessions"("razorpay_order_id");
CREATE UNIQUE INDEX "checkout_sessions_master_order_id_key" ON "checkout_sessions"("master_order_id");
CREATE INDEX "checkout_sessions_status_expires_at_idx" ON "checkout_sessions"("status", "expires_at");
CREATE INDEX "checkout_sessions_customer_id_status_idx" ON "checkout_sessions"("customer_id", "status");
