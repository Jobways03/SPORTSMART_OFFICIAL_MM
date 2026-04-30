-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AffiliateKycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING', 'HOLD', 'CONFIRMED', 'PAID', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AffiliateCommissionSource" AS ENUM ('LINK', 'COUPON');

-- CreateEnum
CREATE TYPE "AffiliatePayoutMethodType" AS ENUM ('BANK', 'UPI');

-- CreateEnum
CREATE TYPE "AffiliatePayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "website_url" TEXT,
    "social_handle" TEXT,
    "join_reason" TEXT,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "commission_percentage" DECIMAL(5,2),
    "kyc_status" "AffiliateKycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "kyc_verified_at" TIMESTAMP(3),
    "password_hash" TEXT NOT NULL,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "fraud_flag_count" INTEGER NOT NULL DEFAULT 0,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_coupon_codes" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "min_order_value" DECIMAL(10,2),
    "customer_discount_type" TEXT,
    "customer_discount_value" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_coupon_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "visitor_id" TEXT,
    "user_id" TEXT,
    "source" "AffiliateCommissionSource" NOT NULL DEFAULT 'LINK',
    "code" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "landing_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attributions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "source" "AffiliateCommissionSource" NOT NULL,
    "code" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "source" "AffiliateCommissionSource" NOT NULL,
    "code" TEXT,
    "order_subtotal" DECIMAL(12,2) NOT NULL,
    "commission_percentage" DECIMAL(5,2) NOT NULL,
    "commission_amount" DECIMAL(12,2) NOT NULL,
    "adjusted_amount" DECIMAL(12,2) NOT NULL,
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "return_window_ends_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "hold_reason" TEXT,
    "payout_request_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commission_adjustments" (
    "id" TEXT NOT NULL,
    "commission_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta_amount" DECIMAL(12,2) NOT NULL,
    "before_amount" DECIMAL(12,2) NOT NULL,
    "after_amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_commission_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_kyc" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "pan_number_enc" TEXT NOT NULL,
    "pan_number_iv" TEXT NOT NULL,
    "pan_last4" TEXT NOT NULL,
    "aadhaar_number_enc" TEXT,
    "aadhaar_number_iv" TEXT,
    "aadhaar_last4" TEXT,
    "pan_document_url" TEXT,
    "aadhaar_document_url" TEXT,
    "status" "AffiliateKycStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payout_methods" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "type" "AffiliatePayoutMethodType" NOT NULL,
    "account_number_enc" TEXT,
    "account_number_iv" TEXT,
    "account_last4" TEXT,
    "ifsc_code" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "upi_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payout_requests" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "payout_method_id" TEXT NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "tds_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "financial_year" TEXT NOT NULL,
    "status" "AffiliatePayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "transaction_ref" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_tds_records" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "cumulative_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cumulative_tds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cumulative_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "threshold_crossed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_tds_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_user_id_key" ON "affiliates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_phone_key" ON "affiliates"("phone");

-- CreateIndex
CREATE INDEX "affiliates_status_idx" ON "affiliates"("status");

-- CreateIndex
CREATE INDEX "affiliates_email_idx" ON "affiliates"("email");

-- CreateIndex
CREATE INDEX "affiliates_user_id_idx" ON "affiliates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_coupon_codes_code_key" ON "affiliate_coupon_codes"("code");

-- CreateIndex
CREATE INDEX "affiliate_coupon_codes_affiliate_id_idx" ON "affiliate_coupon_codes"("affiliate_id");

-- CreateIndex
CREATE INDEX "affiliate_coupon_codes_is_active_idx" ON "affiliate_coupon_codes"("is_active");

-- CreateIndex
CREATE INDEX "referrals_affiliate_id_idx" ON "referrals"("affiliate_id");

-- CreateIndex
CREATE INDEX "referrals_visitor_id_idx" ON "referrals"("visitor_id");

-- CreateIndex
CREATE INDEX "referrals_user_id_idx" ON "referrals"("user_id");

-- CreateIndex
CREATE INDEX "referrals_expires_at_idx" ON "referrals"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "referral_attributions_order_id_key" ON "referral_attributions"("order_id");

-- CreateIndex
CREATE INDEX "referral_attributions_affiliate_id_idx" ON "referral_attributions"("affiliate_id");

-- CreateIndex
CREATE INDEX "referral_attributions_code_idx" ON "referral_attributions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_order_id_key" ON "affiliate_commissions"("order_id");

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliate_id_status_idx" ON "affiliate_commissions"("affiliate_id", "status");

-- CreateIndex
CREATE INDEX "affiliate_commissions_status_return_window_ends_at_idx" ON "affiliate_commissions"("status", "return_window_ends_at");

-- CreateIndex
CREATE INDEX "affiliate_commissions_payout_request_id_idx" ON "affiliate_commissions"("payout_request_id");

-- CreateIndex
CREATE INDEX "affiliate_commission_adjustments_commission_id_idx" ON "affiliate_commission_adjustments"("commission_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_kyc_affiliate_id_key" ON "affiliate_kyc"("affiliate_id");

-- CreateIndex
CREATE INDEX "affiliate_kyc_status_idx" ON "affiliate_kyc"("status");

-- CreateIndex
CREATE INDEX "affiliate_kyc_pan_last4_idx" ON "affiliate_kyc"("pan_last4");

-- CreateIndex
CREATE INDEX "affiliate_payout_methods_affiliate_id_idx" ON "affiliate_payout_methods"("affiliate_id");

-- CreateIndex
CREATE INDEX "affiliate_payout_methods_account_last4_idx" ON "affiliate_payout_methods"("account_last4");

-- CreateIndex
CREATE INDEX "affiliate_payout_requests_affiliate_id_status_idx" ON "affiliate_payout_requests"("affiliate_id", "status");

-- CreateIndex
CREATE INDEX "affiliate_payout_requests_status_idx" ON "affiliate_payout_requests"("status");

-- CreateIndex
CREATE INDEX "affiliate_payout_requests_financial_year_idx" ON "affiliate_payout_requests"("financial_year");

-- CreateIndex
CREATE INDEX "affiliate_tds_records_financial_year_idx" ON "affiliate_tds_records"("financial_year");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_tds_records_affiliate_id_financial_year_key" ON "affiliate_tds_records"("affiliate_id", "financial_year");

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_coupon_codes" ADD CONSTRAINT "affiliate_coupon_codes_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "affiliate_payout_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commission_adjustments" ADD CONSTRAINT "affiliate_commission_adjustments_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "affiliate_commissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_kyc" ADD CONSTRAINT "affiliate_kyc_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payout_methods" ADD CONSTRAINT "affiliate_payout_methods_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payout_requests" ADD CONSTRAINT "affiliate_payout_requests_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payout_requests" ADD CONSTRAINT "affiliate_payout_requests_payout_method_id_fkey" FOREIGN KEY ("payout_method_id") REFERENCES "affiliate_payout_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_tds_records" ADD CONSTRAINT "affiliate_tds_records_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

