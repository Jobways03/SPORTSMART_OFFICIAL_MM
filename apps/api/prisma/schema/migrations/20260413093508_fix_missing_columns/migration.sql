-- CreateEnum
CREATE TYPE "FranchiseStatus" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "FranchiseVerificationStatus" AS ENUM ('NOT_VERIFIED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SOURCING', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FranchiseLedgerSource" AS ENUM ('ONLINE_ORDER', 'PROCUREMENT_FEE', 'RETURN_REVERSAL', 'ADJUSTMENT', 'PENALTY');

-- CreateEnum
CREATE TYPE "FranchiseLedgerStatus" AS ENUM ('PENDING', 'ACCRUED', 'HOLD', 'SETTLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FranchiseSettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "PosSaleStatus" AS ENUM ('COMPLETED', 'VOIDED', 'RETURNED', 'PARTIALLY_RETURNED');

-- CreateEnum
CREATE TYPE "ProcurementItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SOURCED', 'DISPATCHED', 'RECEIVED', 'SHORT', 'DAMAGED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PROCUREMENT_IN', 'ORDER_RESERVE', 'ORDER_UNRESERVE', 'ORDER_SHIP', 'ORDER_RETURN', 'ORDER_CANCEL', 'POS_SALE', 'POS_RETURN', 'DAMAGE', 'LOSS', 'ADJUSTMENT', 'AUDIT_CORRECTION');

-- CreateEnum
CREATE TYPE "FranchiseStaffRole" AS ENUM ('OWNER', 'MANAGER', 'POS_OPERATOR', 'WAREHOUSE_STAFF');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED', 'QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED', 'REFUND_PROCESSING', 'REFUNDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReasonCategory" AS ENUM ('DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'DAMAGED_IN_TRANSIT', 'CHANGED_MIND', 'SIZE_FIT_ISSUE', 'QUALITY_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "QcOutcome" AS ENUM ('APPROVED', 'REJECTED', 'PARTIAL', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ReturnRefundMethod" AS ENUM ('ORIGINAL_PAYMENT', 'WALLET', 'BANK_TRANSFER', 'CASH');

-- AlterTable
ALTER TABLE "allocation_logs" ADD COLUMN     "allocated_franchise_id" TEXT,
ADD COLUMN     "allocated_node_type" TEXT;

-- AlterTable
ALTER TABLE "sub_orders" ADD COLUMN     "commission_rate_snapshot" DECIMAL(5,2),
ADD COLUMN     "courier_name" TEXT,
ADD COLUMN     "franchise_id" TEXT,
ADD COLUMN     "fulfillment_node_type" TEXT NOT NULL DEFAULT 'SELLER',
ADD COLUMN     "shipping_label_url" TEXT,
ADD COLUMN     "tracking_number" TEXT,
ALTER COLUMN "seller_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "admin_password_reset_otps" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_partners" (
    "id" TEXT NOT NULL,
    "franchise_code" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "FranchiseStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "FranchiseVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "pincode" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "online_fulfillment_rate" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "procurement_fee_rate" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "contract_start_date" TIMESTAMP(3),
    "contract_end_date" TIMESTAMP(3),
    "warehouse_address" TEXT,
    "warehouse_pincode" TEXT,
    "profile_image_url" TEXT,
    "profile_image_public_id" TEXT,
    "logo_url" TEXT,
    "logo_public_id" TEXT,
    "assigned_zone" TEXT,
    "profile_completion_percentage" INTEGER NOT NULL DEFAULT 0,
    "is_profile_completed" BOOLEAN NOT NULL DEFAULT false,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_sessions" (
    "id" TEXT NOT NULL,
    "franchise_partner_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_password_reset_otps" (
    "id" TEXT NOT NULL,
    "franchise_partner_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_coverage_areas" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "coverage_type" TEXT NOT NULL,
    "state_code" TEXT,
    "state_name" TEXT,
    "city_name" TEXT,
    "pincode" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_coverage_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_catalog_mappings" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "global_sku" TEXT NOT NULL,
    "franchise_sku" TEXT,
    "barcode" TEXT,
    "is_listed_for_online_fulfillment" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "approval_status" "MappingApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_catalog_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_stock" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "global_sku" TEXT NOT NULL,
    "franchise_sku" TEXT,
    "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "available_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_qty" INTEGER NOT NULL DEFAULT 0,
    "in_transit_qty" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "last_restocked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_inventory_ledger" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "global_sku" TEXT NOT NULL,
    "movement_type" "InventoryMovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT,
    "remarks" TEXT,
    "before_qty" INTEGER NOT NULL,
    "after_qty" INTEGER NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_inventory_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_requests" (
    "id" TEXT NOT NULL,
    "request_number" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'DRAFT',
    "total_requested_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_approved_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "procurement_fee_rate" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "procurement_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "final_payable_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "requested_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_request_items" (
    "id" TEXT NOT NULL,
    "procurement_request_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "global_sku" TEXT NOT NULL,
    "product_title" TEXT NOT NULL DEFAULT '',
    "variant_title" TEXT,
    "status" "ProcurementItemStatus" NOT NULL DEFAULT 'PENDING',
    "requested_qty" INTEGER NOT NULL,
    "approved_qty" INTEGER NOT NULL DEFAULT 0,
    "sourced_qty" INTEGER NOT NULL DEFAULT 0,
    "dispatched_qty" INTEGER NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_qty" INTEGER NOT NULL DEFAULT 0,
    "source_seller_id" TEXT,
    "landed_unit_cost" DECIMAL(10,2),
    "procurement_fee_per_unit" DECIMAL(10,2),
    "final_unit_cost_to_franchise" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_sequences" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "procurement_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pos_sales" (
    "id" TEXT NOT NULL,
    "sale_number" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "sale_type" TEXT NOT NULL DEFAULT 'WALK_IN',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "gross_amount" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(10,2) NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'CASH',
    "status" "PosSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_staff_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pos_sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "global_sku" TEXT NOT NULL,
    "franchise_sku" TEXT,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "line_discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_pos_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale_sequences" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pos_sale_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_code_sequences" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "franchise_code_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_finance_ledger" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "source_type" "FranchiseLedgerSource" NOT NULL,
    "source_id" TEXT NOT NULL,
    "description" TEXT,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "computed_amount" DECIMAL(12,2) NOT NULL,
    "platform_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "franchise_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "FranchiseLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "settlement_batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_finance_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_settlements" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "franchise_name" TEXT NOT NULL,
    "total_online_orders" INTEGER NOT NULL DEFAULT 0,
    "total_online_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_online_commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_procurements" INTEGER NOT NULL DEFAULT 0,
    "total_procurement_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_procurement_fees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_pos_sales" INTEGER NOT NULL DEFAULT 0,
    "total_pos_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_pos_fees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reversal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross_franchise_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_platform_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_payable_to_franchise" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "FranchiseSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_staff" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "FranchiseStaffRole" NOT NULL DEFAULT 'POS_OPERATOR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "initiated_by" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "initiator_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejection_reason" TEXT,
    "pickup_scheduled_at" TIMESTAMP(3),
    "pickup_address" JSONB,
    "pickup_tracking_number" TEXT,
    "pickup_courier" TEXT,
    "received_at" TIMESTAMP(3),
    "received_by" TEXT,
    "qc_completed_at" TIMESTAMP(3),
    "qc_decision" "QcOutcome",
    "qc_notes" TEXT,
    "refund_method" "ReturnRefundMethod",
    "refund_amount" DECIMAL(10,2),
    "refund_processed_at" TIMESTAMP(3),
    "refund_reference" TEXT,
    "refund_attempts" INTEGER NOT NULL DEFAULT 0,
    "refund_last_attempt_at" TIMESTAMP(3),
    "refund_failure_reason" TEXT,
    "refund_initiated_by" TEXT,
    "refund_initiated_at" TIMESTAMP(3),
    "customer_notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason_category" "ReturnReasonCategory" NOT NULL,
    "reason_detail" TEXT,
    "qc_outcome" "QcOutcome",
    "qc_quantity_approved" INTEGER,
    "qc_notes" TEXT,
    "refund_amount" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_evidence" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploader_id" TEXT,
    "file_type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "public_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_status_history" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "from_status" "ReturnStatus",
    "to_status" "ReturnStatus" NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_sequences" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "return_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_password_reset_otps_reset_token_key" ON "admin_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "admin_password_reset_otps_admin_id_idx" ON "admin_password_reset_otps"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_franchise_code_key" ON "franchise_partners"("franchise_code");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_email_key" ON "franchise_partners"("email");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_phone_number_key" ON "franchise_partners"("phone_number");

-- CreateIndex
CREATE INDEX "franchise_partners_status_idx" ON "franchise_partners"("status");

-- CreateIndex
CREATE INDEX "franchise_partners_is_profile_completed_idx" ON "franchise_partners"("is_profile_completed");

-- CreateIndex
CREATE INDEX "franchise_partners_assigned_zone_idx" ON "franchise_partners"("assigned_zone");

-- CreateIndex
CREATE INDEX "franchise_partners_state_idx" ON "franchise_partners"("state");

-- CreateIndex
CREATE INDEX "franchise_partners_email_idx" ON "franchise_partners"("email");

-- CreateIndex
CREATE INDEX "franchise_partners_phone_number_idx" ON "franchise_partners"("phone_number");

-- CreateIndex
CREATE INDEX "franchise_sessions_franchise_partner_id_idx" ON "franchise_sessions"("franchise_partner_id");

-- CreateIndex
CREATE INDEX "franchise_sessions_refresh_token_idx" ON "franchise_sessions"("refresh_token");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_password_reset_otps_reset_token_key" ON "franchise_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "franchise_password_reset_otps_franchise_partner_id_idx" ON "franchise_password_reset_otps"("franchise_partner_id");

-- CreateIndex
CREATE INDEX "franchise_coverage_areas_state_code_is_active_idx" ON "franchise_coverage_areas"("state_code", "is_active");

-- CreateIndex
CREATE INDEX "franchise_coverage_areas_pincode_is_active_idx" ON "franchise_coverage_areas"("pincode", "is_active");

-- CreateIndex
CREATE INDEX "franchise_coverage_areas_franchise_id_idx" ON "franchise_coverage_areas"("franchise_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_coverage_areas_franchise_id_coverage_type_state_c_key" ON "franchise_coverage_areas"("franchise_id", "coverage_type", "state_code", "city_name", "pincode");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_franchise_id_is_active_idx" ON "franchise_catalog_mappings"("franchise_id", "is_active");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_product_id_idx" ON "franchise_catalog_mappings"("product_id");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_approval_status_idx" ON "franchise_catalog_mappings"("approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_catalog_mappings_franchise_id_product_id_variant__key" ON "franchise_catalog_mappings"("franchise_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "franchise_stock_franchise_id_available_qty_idx" ON "franchise_stock"("franchise_id", "available_qty");

-- CreateIndex
CREATE INDEX "franchise_stock_franchise_id_idx" ON "franchise_stock"("franchise_id");

-- CreateIndex
CREATE INDEX "franchise_stock_product_id_idx" ON "franchise_stock"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_stock_franchise_id_product_id_variant_id_key" ON "franchise_stock"("franchise_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "franchise_inventory_ledger_franchise_id_product_id_idx" ON "franchise_inventory_ledger"("franchise_id", "product_id");

-- CreateIndex
CREATE INDEX "franchise_inventory_ledger_reference_type_reference_id_idx" ON "franchise_inventory_ledger"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "franchise_inventory_ledger_created_at_idx" ON "franchise_inventory_ledger"("created_at");

-- CreateIndex
CREATE INDEX "franchise_inventory_ledger_movement_type_idx" ON "franchise_inventory_ledger"("movement_type");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_requests_request_number_key" ON "procurement_requests"("request_number");

-- CreateIndex
CREATE INDEX "procurement_requests_franchise_id_status_idx" ON "procurement_requests"("franchise_id", "status");

-- CreateIndex
CREATE INDEX "procurement_requests_status_idx" ON "procurement_requests"("status");

-- CreateIndex
CREATE INDEX "procurement_requests_request_number_idx" ON "procurement_requests"("request_number");

-- CreateIndex
CREATE INDEX "procurement_request_items_procurement_request_id_idx" ON "procurement_request_items"("procurement_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_pos_sales_sale_number_key" ON "franchise_pos_sales"("sale_number");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_franchise_id_sold_at_idx" ON "franchise_pos_sales"("franchise_id", "sold_at");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_status_idx" ON "franchise_pos_sales"("status");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_sale_number_idx" ON "franchise_pos_sales"("sale_number");

-- CreateIndex
CREATE INDEX "franchise_pos_sale_items_sale_id_idx" ON "franchise_pos_sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_franchise_id_status_idx" ON "franchise_finance_ledger"("franchise_id", "status");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_source_type_source_id_idx" ON "franchise_finance_ledger"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_settlement_batch_id_idx" ON "franchise_finance_ledger"("settlement_batch_id");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_created_at_idx" ON "franchise_finance_ledger"("created_at");

-- CreateIndex
CREATE INDEX "franchise_settlements_cycle_id_idx" ON "franchise_settlements"("cycle_id");

-- CreateIndex
CREATE INDEX "franchise_settlements_franchise_id_idx" ON "franchise_settlements"("franchise_id");

-- CreateIndex
CREATE INDEX "franchise_settlements_status_idx" ON "franchise_settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_settlements_cycle_id_franchise_id_key" ON "franchise_settlements"("cycle_id", "franchise_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_staff_email_key" ON "franchise_staff"("email");

-- CreateIndex
CREATE INDEX "franchise_staff_franchise_id_is_active_idx" ON "franchise_staff"("franchise_id", "is_active");

-- CreateIndex
CREATE INDEX "franchise_staff_email_idx" ON "franchise_staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "returns_return_number_key" ON "returns"("return_number");

-- CreateIndex
CREATE INDEX "returns_customer_id_idx" ON "returns"("customer_id");

-- CreateIndex
CREATE INDEX "returns_sub_order_id_idx" ON "returns"("sub_order_id");

-- CreateIndex
CREATE INDEX "returns_master_order_id_idx" ON "returns"("master_order_id");

-- CreateIndex
CREATE INDEX "returns_status_idx" ON "returns"("status");

-- CreateIndex
CREATE INDEX "returns_return_number_idx" ON "returns"("return_number");

-- CreateIndex
CREATE INDEX "return_items_return_id_idx" ON "return_items"("return_id");

-- CreateIndex
CREATE INDEX "return_items_order_item_id_idx" ON "return_items"("order_item_id");

-- CreateIndex
CREATE INDEX "return_evidence_return_id_idx" ON "return_evidence"("return_id");

-- CreateIndex
CREATE INDEX "return_status_history_return_id_idx" ON "return_status_history"("return_id");

-- CreateIndex
CREATE INDEX "allocation_logs_allocated_franchise_id_idx" ON "allocation_logs"("allocated_franchise_id");

-- CreateIndex
CREATE INDEX "sub_orders_franchise_id_idx" ON "sub_orders"("franchise_id");

-- CreateIndex
CREATE INDEX "sub_orders_fulfillment_node_type_idx" ON "sub_orders"("fulfillment_node_type");

-- AddForeignKey
ALTER TABLE "admin_password_reset_otps" ADD CONSTRAINT "admin_password_reset_otps_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_sessions" ADD CONSTRAINT "franchise_sessions_franchise_partner_id_fkey" FOREIGN KEY ("franchise_partner_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_password_reset_otps" ADD CONSTRAINT "franchise_password_reset_otps_franchise_partner_id_fkey" FOREIGN KEY ("franchise_partner_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_coverage_areas" ADD CONSTRAINT "franchise_coverage_areas_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mappings" ADD CONSTRAINT "franchise_catalog_mappings_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mappings" ADD CONSTRAINT "franchise_catalog_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mappings" ADD CONSTRAINT "franchise_catalog_mappings_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_stock" ADD CONSTRAINT "franchise_stock_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_inventory_ledger" ADD CONSTRAINT "franchise_inventory_ledger_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_request_items" ADD CONSTRAINT "procurement_request_items_procurement_request_id_fkey" FOREIGN KEY ("procurement_request_id") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pos_sales" ADD CONSTRAINT "franchise_pos_sales_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pos_sale_items" ADD CONSTRAINT "franchise_pos_sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "franchise_pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_finance_ledger" ADD CONSTRAINT "franchise_finance_ledger_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_finance_ledger" ADD CONSTRAINT "franchise_finance_ledger_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "franchise_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "settlement_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_staff" ADD CONSTRAINT "franchise_staff_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_status_history" ADD CONSTRAINT "return_status_history_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
