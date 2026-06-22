-- Squashed baseline (2026-06-20). Generated from the canonical prisma/schema
-- via `prisma migrate diff --from-empty`. Replaces 413 drifted migrations that
-- were incomplete (~7 schema tables had no CREATE migration) because dev uses
-- `db push`. The old migrations remain in git history (pre-squash commit).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'SELLER', 'SELLER_STAFF', 'ADMIN', 'SUPPORT', 'AFFILIATE', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('D2C', 'RETAIL');

-- CreateEnum
CREATE TYPE "FileClassification" AS ENUM ('PRODUCT_IMAGE', 'PRODUCT_DOCUMENT', 'KYC_DOCUMENT', 'QC_EVIDENCE', 'SELLER_LOGO', 'RETURN_EVIDENCE', 'GENERAL');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "MappingApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'STOPPED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PLACED', 'PENDING_VERIFICATION', 'VERIFIED', 'ROUTED_TO_SELLER', 'SELLER_ACCEPTED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REJECTED', 'EXCEPTION_QUEUE', 'PARTIALLY_CANCELLED', 'PARTIALLY_SHIPPED', 'PARTIALLY_DELIVERED');

-- CreateEnum
CREATE TYPE "FranchiseStatus" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "FranchiseVerificationStatus" AS ENUM ('NOT_VERIFIED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SOURCING', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FranchiseLedgerSource" AS ENUM ('ONLINE_ORDER', 'POS_SALE', 'POS_SALE_REVERSAL', 'PROCUREMENT_FEE', 'PROCUREMENT_COST', 'RETURN_REVERSAL', 'ADJUSTMENT', 'PENALTY');

-- CreateEnum
CREATE TYPE "FranchiseLedgerStatus" AS ENUM ('PENDING', 'ACCRUED', 'HOLD', 'SETTLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FranchiseSettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'FAILED', 'ON_HOLD', 'PARTIALLY_PAID');

-- CreateEnum
CREATE TYPE "PosSaleStatus" AS ENUM ('COMPLETED', 'VOIDED', 'RETURNED', 'PARTIALLY_RETURNED');

-- CreateEnum
CREATE TYPE "PosSaleType" AS ENUM ('WALK_IN', 'PHONE_ORDER', 'LOCAL_DELIVERY');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD');

-- CreateEnum
CREATE TYPE "PosPaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PosTaxInvoiceStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PosReconciliationStatus" AS ENUM ('SUBMITTED', 'MATCHED', 'VARIANCE', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PosRefundMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'MANUAL');

-- CreateEnum
CREATE TYPE "PosReturnItemCondition" AS ENUM ('SALEABLE', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ProcurementItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SOURCED', 'DISPATCHED', 'RECEIVED', 'SHORT', 'DAMAGED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PROCUREMENT_IN', 'ORDER_RESERVE', 'ORDER_UNRESERVE', 'ORDER_SHIP', 'ORDER_RETURN', 'ORDER_CANCEL', 'POS_SALE', 'POS_RETURN', 'DAMAGE', 'LOSS', 'ADJUSTMENT', 'AUDIT_CORRECTION', 'RTO_RESTOCK', 'POS_VOID');

-- CreateEnum
CREATE TYPE "FranchiseStaffRole" AS ENUM ('OWNER', 'MANAGER', 'POS_OPERATOR', 'WAREHOUSE_STAFF');

-- CreateEnum
CREATE TYPE "FranchiseStaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED', 'QC_APPROVED', 'QC_REJECTED', 'PARTIALLY_APPROVED', 'REFUND_PROCESSING', 'REFUNDED', 'REFUND_FAILED', 'COMPLETED', 'CANCELLED', 'DISPUTE_OVERTURNED', 'DISPUTE_PARTIAL_OVERRIDE', 'DISPUTE_CONFIRMED', 'GOODWILL_CREDITED');

-- CreateEnum
CREATE TYPE "ReturnReasonCategory" AS ENUM ('DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'DAMAGED_IN_TRANSIT', 'CHANGED_MIND', 'SIZE_FIT_ISSUE', 'QUALITY_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "SellerResponseStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'CONTESTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReplacementRequestStatus" AS ENUM ('NONE', 'PENDING_STOCK_CHECK', 'AWAITING_PAYMENT', 'AWAITING_FULFILMENT', 'FULFILLED', 'CANCELLED', 'FALLBACK_TO_REFUND');

-- CreateEnum
CREATE TYPE "QcOutcome" AS ENUM ('APPROVED', 'REJECTED', 'PARTIAL', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ReturnRefundMethod" AS ENUM ('ORIGINAL_PAYMENT', 'WALLET', 'BANK_TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "MetafieldType" AS ENUM ('SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'NUMBER_INTEGER', 'NUMBER_DECIMAL', 'BOOLEAN', 'DATE', 'COLOR', 'URL', 'DIMENSION', 'WEIGHT', 'VOLUME', 'RATING', 'JSON', 'SINGLE_SELECT', 'MULTI_SELECT', 'FILE_REFERENCE');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('SELF_DELIVERY', 'DELHIVERY');

-- CreateEnum
CREATE TYPE "SelfDeliveryStatus" AS ENUM ('PENDING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccessActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "AccessEventKind" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'LOGOUT_ALL_DEVICES', 'TOKEN_REFRESH', 'PASSWORD_RESET', 'NEW_DEVICE_DETECTED', 'MFA_VERIFY_SUCCESS', 'MFA_VERIFY_FAILED', 'OTP_VERIFY_SUCCESS', 'OTP_VERIFY_FAILED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SELLER_ADMIN', 'SELLER_SUPPORT', 'SELLER_OPERATIONS', 'SELLER_OPS', 'AFFILIATE_ADMIN', 'D2C_ADMIN', 'RETAILER_ADMIN', 'FRANCHISE_ADMIN');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SellerVerificationStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "ImpersonationTargetType" AS ENUM ('SELLER', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AffiliateCustomerDiscountType" AS ENUM ('PERCENT', 'FIXED', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "AffiliateKycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING', 'HOLD', 'CONFIRMED', 'PAID', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AffiliateCommissionSource" AS ENUM ('LINK', 'COUPON');

-- CreateEnum
CREATE TYPE "AffiliatePayoutMethodType" AS ENUM ('BANK', 'UPI');

-- CreateEnum
CREATE TYPE "AffiliatePayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AffiliateCouponSource" AS ENUM ('REGISTRATION_AUTO', 'ADMIN_MANUAL', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "ReferralAttributionStatus" AS ENUM ('ACTIVE', 'REVERSED', 'FRAUD_VOIDED');

-- CreateEnum
CREATE TYPE "AiGenerationStatus" AS ENUM ('GENERATED', 'ACCEPTED', 'DISCARDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApiKeyEnvironment" AS ENUM ('LIVE', 'TEST');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE', 'SYSTEM', 'CRON', 'WEBHOOK', 'PAYMENT_PROVIDER', 'LOGISTICS_PROVIDER');

-- CreateEnum
CREATE TYPE "AuditChainIssueType" AS ENUM ('HASH_MISMATCH', 'PREVIOUS_HASH_MISMATCH', 'MISSING_SEQUENCE', 'DUPLICATE_SEQUENCE', 'OUT_OF_ORDER_ROW', 'GENESIS_INVALID', 'ANCHOR_MISMATCH', 'ROW_UNREADABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AuditChainVerificationRunType" AS ENUM ('FAST', 'FULL', 'SAMPLE');

-- CreateEnum
CREATE TYPE "AuditChainVerificationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PolicyEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "PolicyPrincipalType" AS ENUM ('ROLE', 'PERMISSION', 'CUSTOM_ROLE', 'ANY');

-- CreateEnum
CREATE TYPE "AuthorizationLayer" AS ENUM ('PERMISSIONS', 'POLICY');

-- CreateEnum
CREATE TYPE "AuthorizationDecisionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "AuthzReviewStatus" AS ENUM ('UNREVIEWED', 'FALSE_POSITIVE', 'EXPECTED_DENY', 'FIXED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BulkJobKind" AS ENUM ('RETURN_APPROVE', 'RETURN_CLOSE', 'OTHER');

-- CreateEnum
CREATE TYPE "BulkJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DuplicateSourceType" AS ENUM ('RETURN', 'DISPUTE', 'TICKET');

-- CreateEnum
CREATE TYPE "CategoryAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE', 'REORDER');

-- CreateEnum
CREATE TYPE "BrandAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE', 'LOGO_CHANGE', 'BULK_ASSIGN');

-- CreateEnum
CREATE TYPE "TaxAttestationAction" AS ENUM ('ATTESTED', 'RESET', 'EDITED', 'BULK_EDITED');

-- CreateEnum
CREATE TYPE "CollectionAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'IMAGE_CHANGE', 'ATTACH', 'DETACH', 'REORDER');

-- CreateEnum
CREATE TYPE "MetafieldDefinitionAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE', 'REACTIVATE', 'BULK_ASSIGN');

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('CREATED', 'PAID', 'ORDER_CREATED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "CodRuleKind" AS ENUM ('PINCODE_ALLOW', 'PINCODE_DENY', 'VALUE_LIMIT', 'SELLER_DENY', 'CUSTOMER_RISK');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'EXPORTED', 'PARTIALLY_PAID', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'EXPORTED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BankResponseSource" AS ENUM ('FILE_UPLOAD', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED', 'PERCENTAGE_PLUS_FIXED', 'FIXED_PLUS_PERCENTAGE', 'MARGIN_BASED');

-- CreateEnum
CREATE TYPE "CommissionRecordStatus" AS ENUM ('PENDING', 'ON_HOLD', 'SETTLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CommissionReversalSource" AS ENUM ('RETURN_QC', 'MANUAL', 'SELLER_REVERSAL');

-- CreateEnum
CREATE TYPE "CommissionHoldAction" AS ENUM ('HOLD', 'RESUME', 'SYSTEM_FREEZE', 'SYSTEM_UNFREEZE');

-- CreateEnum
CREATE TYPE "BannerSlot" AS ENUM ('HOMEPAGE_HERO', 'CATEGORY_HEADER', 'BRAND_HEADER', 'CART_BANNER', 'CHECKOUT_BANNER');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StorefrontDeviceVisibility" AS ENUM ('ALL', 'DESKTOP_ONLY', 'MOBILE_ONLY');

-- CreateEnum
CREATE TYPE "BlogPostStatus" AS ENUM ('HIDDEN', 'VISIBLE', 'SCHEDULED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "ErasureSubjectType" AS ENUM ('USER', 'SELLER', 'AFFILIATE', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "ErasureStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT_OFF_PRODUCTS', 'BUY_X_GET_Y', 'AMOUNT_OFF_ORDER', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "DiscountMethod" AS ENUM ('CODE', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "DiscountValueType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "DiscountAppliesTo" AS ENUM ('ALL_PRODUCTS', 'SPECIFIC_COLLECTIONS', 'SPECIFIC_PRODUCTS');

-- CreateEnum
CREATE TYPE "DiscountMinRequirement" AS ENUM ('NONE', 'MIN_PURCHASE_AMOUNT', 'MIN_QUANTITY');

-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('ACTIVE', 'SCHEDULED', 'EXPIRED', 'DRAFT', 'PAUSED', 'ARCHIVED', 'SUSPENDED_FOR_ABUSE');

-- CreateEnum
CREATE TYPE "BxgyGetDiscountType" AS ENUM ('PERCENTAGE', 'AMOUNT_OFF', 'FREE');

-- CreateEnum
CREATE TYPE "DiscountFundingType" AS ENUM ('PLATFORM', 'SELLER', 'BRAND', 'FRANCHISE', 'SHARED', 'NONE');

-- CreateEnum
CREATE TYPE "DiscountCommissionBasis" AS ENUM ('GROSS', 'NET_AFTER_DISCOUNT', 'SELLER_FUNDED_NET');

-- CreateEnum
CREATE TYPE "DiscountNature" AS ENUM ('TRANSACTIONAL', 'DISPLAY_ONLY');

-- CreateEnum
CREATE TYPE "DiscountTaxTreatment" AS ENUM ('PRE_SUPPLY_TRANSACTIONAL', 'POST_SUPPLY_LINKED', 'POST_SUPPLY_UNLINKED', 'DISPLAY_ONLY');

-- CreateEnum
CREATE TYPE "DiscountSource" AS ENUM ('CODE', 'AUTOMATIC', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "DiscountRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountCodeStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'USED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DiscountLiabilityParty" AS ENUM ('PLATFORM', 'SELLER', 'BRAND', 'FRANCHISE', 'SHARED');

-- CreateEnum
CREATE TYPE "DiscountLiabilityStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED', 'SETTLED');

-- CreateEnum
CREATE TYPE "CouponAttemptResult" AS ENUM ('VALID', 'INVALID', 'EXPIRED', 'NOT_ELIGIBLE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DiscountEligibilityRuleType" AS ENUM ('FIRST_ORDER_ONLY', 'NEW_CUSTOMER_ONLY', 'CUSTOMER_TIER_IN', 'CUSTOMER_SEGMENT_IN', 'SELLER_IN', 'CATEGORY_IN', 'PRODUCT_IN', 'COLLECTION_IN', 'PAYMENT_METHOD_IN', 'CITY_IN', 'PINCODE_IN', 'MIN_CART_VALUE', 'MIN_ELIGIBLE_ITEM_QUANTITY', 'MAX_REDEMPTIONS_PER_CUSTOMER', 'MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW', 'MIN_DAYS_BETWEEN_REDEMPTIONS');

-- CreateEnum
CREATE TYPE "DisputeKind" AS ENUM ('RETURN_REJECTED', 'WRONG_ITEM_RECEIVED', 'DAMAGED_IN_TRANSIT', 'MISSING_FROM_PARCEL', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_INFO', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputeActorType" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "LiabilityParty" AS ENUM ('NONE', 'SELLER', 'LOGISTICS', 'PLATFORM', 'CUSTOMER', 'FRANCHISE', 'BRAND', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "CustomerRemedy" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'NO_REFUND', 'GOODWILL_CREDIT', 'REPLACEMENT', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "EWayBillStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'PENDING', 'GENERATED', 'CANCELLED', 'CANCELLATION_PENDING', 'CANCELLATION_FAILED', 'EXPIRED', 'FAILED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "EWayBillTransportMode" AS ENUM ('ROAD', 'RAIL', 'AIR', 'SHIP');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY', 'DELETED');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('KYC_DOCUMENT', 'BANK_PROOF', 'QC_EVIDENCE', 'DISPUTE_EVIDENCE', 'INVOICE', 'PRODUCT_IMAGE', 'PRODUCT_VIDEO', 'BANNER', 'AVATAR', 'TICKET_ATTACHMENT', 'SHIPMENT_EVIDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "shipment_evidence_kind_enum" AS ENUM ('PACKING', 'DISPATCH', 'POD', 'RTO_PROOF', 'EXCEPTION', 'CUSTOMER_REJECT', 'ADMIN_OVERRIDE', 'ARCHIVED_REASSIGNMENT');

-- CreateEnum
CREATE TYPE "shipment_evidence_actor_enum" AS ENUM ('SELLER', 'FRANCHISE', 'ADMIN', 'CUSTOMER', 'CARRIER_WEBHOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FranchiseReversalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FranchisePenaltyApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TcsStatus" AS ENUM ('COMPUTED', 'COLLECTED', 'FILED', 'PAID_TO_GOVT', 'CERTIFICATE_ISSUED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TcsLedgerEventType" AS ENUM ('COMPUTED', 'COLLECTED', 'FILED', 'PAID_TO_GOVT', 'CERTIFICATE_ISSUED', 'REVERSED');

-- CreateEnum
CREATE TYPE "IdempotencyKeyState" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "Tds194OStatus" AS ENUM ('COMPUTED', 'WITHHELD', 'DEPOSITED', 'CERTIFICATE_ISSUED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SellerDebitStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogisticsClaimStatus" AS ENUM ('PENDING', 'SUBMITTED', 'ACCEPTED', 'RECOVERED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlatformExpenseType" AS ENUM ('GOODWILL', 'PLATFORM_FAULT', 'EXCEPTION', 'ROUNDING_ADJUSTMENT', 'ABSORBED_GST');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('RETURN', 'DISPUTE', 'GOODWILL', 'MANUAL', 'RTO', 'SELLER_REVERSAL');

-- CreateEnum
CREATE TYPE "AdminTaskKind" AS ENUM ('REFUND_INSTRUCTION_FAILED', 'LOGISTICS_CLAIM_REVIEW', 'SELLER_DEBIT_DISPUTED', 'RETURN_REFUND_FAILED', 'RETURN_LIABILITY_LEDGER_BACKFILL', 'GST_CREDIT_NOTE_TIME_BARRED', 'GST_CREDIT_NOTE_TIME_BAR_APPROACHING', 'EWAY_BILL_GENERATION_FAILED', 'EWAY_BILL_EXPIRED', 'GSTR8_FILING_DUE', 'TCS_COMPUTATION_FAILED', 'TAX_DOCUMENT_PDF_FAILED', 'EINVOICE_GENERATION_FAILED', 'EINVOICE_CANCELLATION_FAILED', 'RETURN_QC_PENDING', 'RETURN_NOTIFICATION_NO_NODE', 'COD_COLLECTION_OVERDUE', 'CHARGEBACK_EVIDENCE_DUE', 'REFUND_CLARIFICATION_REQUESTED', 'DISPUTE_REFUND_REJECTED_NEEDS_REDECISION', 'ORDER_ALLOCATION_EXCEPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "AdminTaskStatus" AS ENUM ('OPEN', 'CLAIMED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DispatchPath" AS ENUM ('TEMPLATE', 'RAW');

-- CreateEnum
CREATE TYPE "AdminDispatchAlertType" AS ENUM ('ACCOUNT_SECURITY', 'FRAUD_ALERT', 'COMPLIANCE_NOTICE', 'CRITICAL_SERVICE');

-- CreateEnum
CREATE TYPE "NotificationDispatchStatus" AS ENUM ('ENQUEUED', 'SUPPRESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'RETRY', 'RETRYING', 'CANCELLED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "NotificationFailureCode" AS ENUM ('INVALID_EMAIL', 'INVALID_PHONE', 'BOUNCED', 'SPAM_COMPLAINT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'AUTH_FAILED', 'NETWORK_TIMEOUT', 'BLOCKED_BY_SUPPRESSION', 'BLOCKED_BY_PREFERENCE', 'MALFORMED_TEMPLATE', 'NOT_CONFIGURED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WhatsappDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'EXPIRED', 'VOIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderFulfillmentStatus" AS ENUM ('UNFULFILLED', 'PACKED', 'SHIPPED', 'FULFILLED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderAcceptStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubOrderRejectionType" AS ENUM ('MANUAL', 'AUTO_SLA', 'ADMIN_FORCE');

-- CreateEnum
CREATE TYPE "CancellationSource" AS ENUM ('ADMIN', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DeliveryConfirmationSource" AS ENUM ('WEBHOOK_SHIPROCKET', 'MANUAL_ADMIN', 'MANUAL_FRANCHISE', 'WEBHOOK_DELHIVERY');

-- CreateEnum
CREATE TYPE "AwbAttachmentSource" AS ENUM ('SELLER_MANUAL', 'FRANCHISE_MANUAL', 'ADMIN_OVERRIDE', 'SHIPROCKET_BOOKING', 'DELHIVERY_BOOKING');

-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('COD', 'ONLINE');

-- CreateEnum
CREATE TYPE "OrderRiskBand" AS ENUM ('GREEN', 'YELLOW', 'RED', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CommissionDecision" AS ENUM ('PENDING', 'PROCESSED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "OrderRiskScoreSource" AS ENUM ('RULES', 'MANUAL');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationExceptionReason" AS ENUM ('NO_PINCODE_ON_ORDER', 'PINCODE_UNSERVICEABLE', 'NO_STOCK_AVAILABLE', 'NO_NODE_MAPPED', 'SELLER_REJECTED', 'NODE_SUSPENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OrderItemKind" AS ENUM ('PHYSICAL', 'DIGITAL', 'SERVICE', 'SUBSCRIPTION', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "OrderVerificationDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderClaimReleaseReason" AS ENUM ('EXPLICIT_RELEASE', 'TTL_EXPIRY', 'APPROVED', 'REJECTED', 'FORCE_RELEASE', 'ORDER_VIA_BYPASS');

-- CreateEnum
CREATE TYPE "OrderRiskReasonCode" AS ENUM ('FIRST_TIME_CUSTOMER', 'REPEAT_CUSTOMER', 'COD_PAYMENT', 'ONLINE_CAPTURED', 'ONLINE_NOT_CAPTURED', 'VERY_HIGH_VALUE', 'HIGH_VALUE', 'BULK_ORDER', 'PINCODE_RTO', 'CANCELLATION_HISTORY', 'SUSPICIOUS_EMAIL', 'VELOCITY', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderReassignmentEventType" AS ENUM ('ADMIN_MANUAL_OVERRIDE', 'AUTO_AFTER_SELLER_REJECT', 'AUTO_AFTER_FRANCHISE_REJECT', 'AUTO_AFTER_EXCEPTION_REMEDIATE');

-- CreateEnum
CREATE TYPE "OrderTimelineEventType" AS ENUM ('ORDER_PLACED', 'ORDER_PAYMENT_CAPTURED', 'ORDER_VERIFICATION_CLAIMED', 'ORDER_VERIFICATION_RELEASED', 'ORDER_VERIFICATION_AUTO_EXPIRED', 'ORDER_VERIFIED', 'ORDER_REJECTED', 'ORDER_ROUTED_TO_SELLER', 'ORDER_EXCEPTION_QUEUE', 'ORDER_PARTIALLY_SHIPPED', 'ORDER_PARTIALLY_DELIVERED', 'ORDER_PARTIALLY_CANCELLED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'SUBORDER_ASSIGNED', 'SUBORDER_ACCEPTED', 'SUBORDER_REJECTED_MANUAL', 'SUBORDER_REJECTED_AUTO_SLA', 'SUBORDER_REASSIGNED', 'SUBORDER_PACKED', 'SUBORDER_SHIPPED', 'SUBORDER_OUT_FOR_DELIVERY', 'SUBORDER_DELIVERED_WEBHOOK', 'SUBORDER_DELIVERED_MANUAL', 'SUBORDER_NDR_ATTEMPT', 'SUBORDER_CANCELLED_BY_ADMIN', 'PAYMENT_INTENT_CREATED', 'PAYMENT_CAPTURED', 'PAYMENT_FAILED', 'REFUND_INITIATED', 'REFUND_COMPLETED', 'REFUND_FAILED', 'COMMISSION_LOCKED', 'COMMISSION_PAID', 'COMMISSION_REVERSED');

-- CreateEnum
CREATE TYPE "TimelineActorType" AS ENUM ('SYSTEM', 'ADMIN', 'SELLER', 'FRANCHISE', 'CUSTOMER', 'CARRIER');

-- CreateEnum
CREATE TYPE "TimelineVisibility" AS ENUM ('ADMIN_ONLY', 'CUSTOMER_VISIBLE', 'SELLER_VISIBLE', 'FRANCHISE_VISIBLE');

-- CreateEnum
CREATE TYPE "LowStockAlertStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OutboxEventState" AS ENUM ('PENDING', 'RETRYING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('SELLER', 'OWN_BRAND');

-- CreateEnum
CREATE TYPE "OwnBrandProcurementStatus" AS ENUM ('DRAFT', 'PLACED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OwnBrandStockMovementKind" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "PaymentAttemptKind" AS ENUM ('CREATE_ORDER', 'CAPTURE', 'VERIFY_SIGNATURE', 'REFUND', 'POLL_STATUS');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "PaymentMismatchKind" AS ENUM ('AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE_PAYMENT', 'ORPHAN_PAYMENT', 'SIGNATURE_INVALID');

-- CreateEnum
CREATE TYPE "PaymentMismatchStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PaymentMismatchSource" AS ENUM ('WEBHOOK', 'POLLER', 'CHECKOUT_VERIFY', 'RECONCILIATION', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChargebackEvidenceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChargebackFinancialImpact" AS ENUM ('HELD', 'RECOVERED', 'LOST', 'NONE');

-- CreateEnum
CREATE TYPE "PaymentLifecycleStatus" AS ENUM ('CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'REFUNDED', 'VOIDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentLifecycleMethod" AS ENUM ('COD', 'ONLINE', 'WALLET_ONLY');

-- CreateEnum
CREATE TYPE "PaymentWebhookProcessingStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED_PERMANENT', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('PAYMENT', 'COD', 'SETTLEMENT', 'REFUND', 'WALLET', 'AFFILIATE_PAYOUT', 'COMMISSION', 'TDS', 'TCS');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscrepancyKind" AS ENUM ('EXPECTED_NOT_FOUND', 'UNEXPECTED_RECORD', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_PAYMENT', 'DUPLICATE_PAYMENT', 'MISSING_REFUND', 'DUPLICATE_REFUND', 'MISSING_UTR', 'PROVIDER_REFERENCE_MISSING', 'SETTLEMENT_MISMATCH', 'ORPHAN_LEDGER_ENTRY');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "RefundSourceType" AS ENUM ('RETURN', 'DISPUTE', 'GOODWILL', 'MANUAL', 'REPLACEMENT', 'VERIFICATION_REJECTION');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('ORIGINAL_PAYMENT', 'WALLET', 'BANK_TRANSFER', 'UPI', 'COUPON', 'MANUAL');

-- CreateEnum
CREATE TYPE "RefundInstructionStatus" AS ENUM ('PENDING_APPROVAL', 'NEEDS_CLARIFICATION', 'APPROVED', 'PROCESSING', 'SUCCESS', 'SETTLED', 'FAILED', 'RETRYING', 'MANUAL_REQUIRED', 'CANCELLED', 'REJECTED', 'ROUTED_BACK_TO_DISPUTE');

-- CreateEnum
CREATE TYPE "RefundSagaStatus" AS ENUM ('STARTED', 'IN_PROGRESS', 'COMPLETED', 'COMPENSATING', 'COMPENSATED', 'COMPENSATION_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('DELETE', 'ARCHIVE', 'REDACT');

-- CreateEnum
CREATE TYPE "RefundTransactionStatus" AS ENUM ('INITIATED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('RESERVED', 'RELEASED', 'CONFIRMED', 'DEDUCTED', 'RESTOCKED', 'WRITE_OFF', 'MANUAL_ADJUST', 'INITIAL', 'DAMAGE', 'LOSS', 'AUDIT_CORRECTION');

-- CreateEnum
CREATE TYPE "SellerReversalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BusinessEntityType" AS ENUM ('PUBLIC_LIMITED', 'PRIVATE_LIMITED', 'SOLE_PROPRIETORSHIP', 'GENERAL_PARTNERSHIP', 'LLP');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AllocationEventSource" AS ENUM ('LIVE', 'REALLOCATION', 'MANUAL_REASSIGNMENT', 'LISTING', 'PREVIEW', 'STOREFRONT');

-- CreateEnum
CREATE TYPE "AllocationOutcome" AS ENUM ('PRIMARY_SERVICEABLE', 'FALLBACK_SERVICEABLE', 'UNSERVICEABLE', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "AllocationReasonCode" AS ENUM ('PRIMARY_HIGHEST_SCORE', 'REALLOCATED_FROM_FAILED', 'NO_SERVICEABLE_NODE', 'MANUAL_REASSIGN');

-- CreateEnum
CREATE TYPE "SettlementCycleStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SellerSettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED', 'FAILED', 'ON_HOLD', 'PARTIALLY_PAID', 'READY_FOR_PAYOUT', 'DRAFT');

-- CreateEnum
CREATE TYPE "SettlementAdjustmentType" AS ENUM ('COURIER_PENALTY', 'SLA_FINE', 'GOODWILL', 'MANUAL_CORRECTION', 'CLAWBACK', 'OTHER');

-- CreateEnum
CREATE TYPE "SettlementAdjustmentStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "ShippingRateType" AS ENUM ('FLAT', 'FREE', 'SLAB');

-- CreateEnum
CREATE TYPE "ShippingSurchargeKind" AS ENUM ('COD', 'FUEL', 'REMOTE_AREA', 'WEEKEND', 'OVERSIZED', 'OVERWEIGHT', 'INSURANCE', 'RETURN');

-- CreateEnum
CREATE TYPE "ShippingSurchargeValueType" AS ENUM ('FLAT_PAISE', 'PERCENT_BPS');

-- CreateEnum
CREATE TYPE "shipment_internal_status_enum" AS ENUM ('CREATED', 'PICKUP_PENDING', 'PICKED_UP', 'MANIFESTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'UNDELIVERED', 'FAILED_DELIVERY', 'RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_DELIVERED', 'LOST', 'DAMAGED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "MenuLinkType" AS ENUM ('COLLECTION', 'CATEGORY', 'BRAND', 'PRODUCT', 'PAGE', 'URL', 'NONE');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "TaxDocumentActorType" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN', 'FRANCHISE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TaxDocumentDownloadOutcome" AS ENUM ('ALLOWED', 'DENIED_SCOPE', 'DENIED_NOT_READY', 'DENIED_RATE_LIMIT', 'DENIED_VOIDED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE_CUM_BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE', 'LEGACY_RECEIPT');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('B2C', 'B2B');

-- CreateEnum
CREATE TYPE "TaxDocumentStatus" AS ENUM ('DRAFT', 'GENERATED', 'PDF_PENDING', 'PDF_GENERATED', 'PDF_FAILED', 'PARTIALLY_REVERSED', 'FULLY_REVERSED', 'SUPERSEDED', 'VOIDED_DRAFT');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'GENERATED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplyTaxability" AS ENUM ('TAXABLE', 'NIL_RATED', 'EXEMPT', 'NON_GST', 'ZERO_RATED', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "GstnPortalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED', 'INACTIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TaxLineType" AS ENUM ('PRODUCT', 'SHIPPING', 'GIFT_WRAP', 'CONVENIENCE_FEE', 'COD_FEE', 'ROUND_OFF', 'DISCOUNT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TaxSplitType" AS ENUM ('CGST_SGST', 'IGST');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('MARKETPLACE_SELLER', 'FRANCHISE', 'OWN_BRAND', 'SPORTSMART');

-- CreateEnum
CREATE TYPE "TaxDataStatus" AS ENUM ('COMPLETE', 'INCOMPLETE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "CreditNoteEligibilityStatus" AS ENUM ('ELIGIBLE', 'TIME_BARRED', 'REQUIRES_FINANCE_REVIEW');

-- CreateEnum
CREATE TYPE "GstMode" AS ENUM ('OFF', 'AUDIT', 'STRICT');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOPUP', 'REFUND', 'CREDIT_ADJUSTMENT', 'DEBIT', 'DEBIT_ADJUSTMENT', 'LOYALTY_REBATE', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'GOODWILL_CREDIT', 'ORDER_REDEMPTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "WalletDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WalletCreditType" AS ENUM ('REFUND_ORIGINAL', 'GOODWILL', 'TIME_BARRED', 'PROMO', 'MANUAL', 'LOYALTY');

-- CreateEnum
CREATE TYPE "WalletRefundSagaStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LoyaltyEarnStatus" AS ENUM ('PENDING', 'POSTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WalletAdjustmentKind" AS ENUM ('TIME_BARRED_CREDIT_NOTE', 'GOODWILL', 'MANUAL_DEBIT', 'MANUAL_OTHER');

-- CreateEnum
CREATE TYPE "WalletAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'FIRST_APPROVED', 'APPROVED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WebhookEnvironment" AS ENUM ('LIVE', 'TEST');

-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED_RETRY', 'FAILED_DEAD');

-- CreateTable
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL,
    "actor_type" "AccessActorType" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT,
    "kind" "AccessEventKind" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_hash" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "country" VARCHAR(2),
    "city" TEXT,
    "request_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SELLER_ADMIN',
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_seeded" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "mfa_secret_ciphertext" TEXT,
    "mfa_pending_secret_ciphertext" TEXT,
    "mfa_pending_expires_at" TIMESTAMP(3),
    "mfa_enabled_at" TIMESTAMP(3),
    "mfa_backup_codes_hashes" JSONB,
    "mfa_last_used_step" INTEGER,
    "failed_mfa_attempts" INTEGER NOT NULL DEFAULT 0,
    "mfa_lock_until" TIMESTAMP(3),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "user_agent" VARCHAR(512),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "device_label" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "step_up_verified_at" TIMESTAMP(3),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_action_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "action_type" TEXT NOT NULL,
    "actor_role" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_action_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_impersonation_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "target_actor_type" "ImpersonationTargetType" NOT NULL,
    "target_actor_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "token_id" TEXT,
    "token_jti" TEXT,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_impersonation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_seller_messages" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "sent_by_admin_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_seller_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_custom_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_custom_role_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_custom_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_role_assignments" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_role_assignments_pkey" PRIMARY KEY ("id")
);

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
    "rejected_by_id" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "suspended_by_id" TEXT,
    "deactivated_at" TIMESTAMP(3),
    "deactivated_by_id" TEXT,
    "reactivated_at" TIMESTAMP(3),
    "reactivated_by_id" TEXT,
    "reactivation_reason" TEXT,
    "commission_percentage" DECIMAL(5,2),
    "commission_percentage_updated_by_id" TEXT,
    "commission_percentage_updated_at" TIMESTAMP(3),
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
CREATE TABLE "affiliate_status_history" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by_admin_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commission_rate_history" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "from_rate" DECIMAL(5,2),
    "to_rate" DECIMAL(5,2),
    "changed_by_admin_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_commission_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_sessions" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "user_agent" VARCHAR(512),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "device_label" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "default_commission_percentage" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "max_codes_per_affiliate" INTEGER NOT NULL DEFAULT 10,
    "minimum_payout_amount" DECIMAL(10,2) NOT NULL DEFAULT 500,
    "return_window_days" INTEGER NOT NULL DEFAULT 7,
    "tds_rate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "tds_threshold_per_fy" DECIMAL(12,2) NOT NULL DEFAULT 15000,
    "tds_section" TEXT NOT NULL DEFAULT '194O',
    "tds_rate_with_pan_bps" INTEGER NOT NULL DEFAULT 100,
    "tds_rate_without_pan_bps" INTEGER NOT NULL DEFAULT 500,
    "commission_reversal_window_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_password_reset_otps" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_coupon_codes" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "min_order_value" DECIMAL(10,2),
    "customer_discount_type" "AffiliateCustomerDiscountType",
    "customer_discount_value" DECIMAL(10,2),
    "max_discount_amount" DECIMAL(10,2),
    "discount_id" TEXT,
    "coupon_source" "AffiliateCouponSource" NOT NULL DEFAULT 'REGISTRATION_AUTO',
    "created_by_admin_id" TEXT,
    "revoked_by_admin_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
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
    "customer_id" TEXT,
    "coupon_code_id" TEXT,
    "status" "ReferralAttributionStatus" NOT NULL DEFAULT 'ACTIVE',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

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
    "confirmed_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "reversed_by_id" TEXT,
    "held_by_id" TEXT,
    "referral_attribution_id" TEXT,
    "coupon_code_id" TEXT,
    "payout_request_id" TEXT,
    "reversal_netted_in_payout_request_id" TEXT,
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
    "reversal_debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tds_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "financial_year" TEXT NOT NULL,
    "tds_section" TEXT NOT NULL DEFAULT '194O',
    "tds_rate_bps" INTEGER,
    "pan_on_file_at_deduction" BOOLEAN,
    "filing_quarter" TEXT,
    "status" "AffiliatePayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_by_id" TEXT,
    "failed_by_id" TEXT,
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "transaction_ref" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejection_reason" TEXT,
    "payout_method_type" TEXT,
    "payout_method_snapshot" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payout_request_status_history" (
    "id" TEXT NOT NULL,
    "payout_request_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by_actor_type" TEXT NOT NULL,
    "changed_by_actor_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_payout_request_status_history_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "affiliate_tds_194o_ledger" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "payout_request_id" TEXT NOT NULL,
    "filing_period" TEXT NOT NULL,
    "pan_last4" TEXT,
    "had_pan_on_file" BOOLEAN NOT NULL DEFAULT false,
    "gross_in_paise" BIGINT NOT NULL,
    "tds_in_paise" BIGINT NOT NULL,
    "tds_rate_bps" INTEGER NOT NULL,
    "status" "Tds194OStatus" NOT NULL DEFAULT 'COMPUTED',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withheld_at" TIMESTAMP(3),
    "deposited_at" TIMESTAMP(3),
    "deposited_by" TEXT,
    "challan_reference" TEXT,
    "bsr_code" TEXT,
    "challan_date" TIMESTAMP(3),
    "certificate_issued_at" TIMESTAMP(3),
    "certificate_issued_by" TEXT,
    "certificate_number" TEXT,
    "filed_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_tds_194o_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_quotas" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subject_type" TEXT,
    "provider" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generation_logs" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subject_type" TEXT,
    "product_id" TEXT,
    "title_hint" TEXT,
    "category_hint" TEXT,
    "brand_hint" TEXT,
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "generated_json" JSONB,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'GENERATED',
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" "ApiKeyEnvironment" NOT NULL DEFAULT 'LIVE',
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "seller_id" TEXT,
    "affiliate_id" TEXT,
    "rate_limit_per_minute" INTEGER,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_usages" (
    "id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ip_prefix" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "sequence_number" BIGSERIAL NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "actor_type" "AuditActorType",
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_chain_tip" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "last_hash" TEXT,
    "last_sequence" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_chain_tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_chain_anchors" (
    "sequence" INTEGER NOT NULL,
    "up_to_audit_log_id" TEXT NOT NULL,
    "expected_hash" TEXT NOT NULL,
    "rows_covered" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_chain_anchors_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "audit_chain_verification_runs" (
    "id" TEXT NOT NULL,
    "run_type" "AuditChainVerificationRunType" NOT NULL,
    "status" "AuditChainVerificationStatus" NOT NULL DEFAULT 'RUNNING',
    "started_by" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "rows_checked" INTEGER NOT NULL DEFAULT 0,
    "issues_found" INTEGER NOT NULL DEFAULT 0,
    "result_summary" JSONB,
    "error_message" TEXT,

    CONSTRAINT "audit_chain_verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_chain_verification_issues" (
    "id" TEXT NOT NULL,
    "verification_run_id" TEXT NOT NULL,
    "audit_log_id" TEXT,
    "issue_type" "AuditChainIssueType" NOT NULL,
    "severity" TEXT NOT NULL,
    "expected_hash" TEXT,
    "actual_hash" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_chain_verification_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effect" "PolicyEffect" NOT NULL DEFAULT 'ALLOW',
    "principal_type" "PolicyPrincipalType" NOT NULL,
    "principal_key" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "conditions" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_admin_id" TEXT,

    CONSTRAINT "resource_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_audits" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "actor_role" TEXT,
    "actor_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "route_label" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "layer" "AuthorizationLayer" NOT NULL,
    "decision" "AuthorizationDecisionEffect" NOT NULL,
    "would_have_blocked" BOOLEAN NOT NULL DEFAULT false,
    "required_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resource_type" TEXT,
    "action" TEXT,
    "matched_policy_id" TEXT,
    "matched_policy_name" TEXT,
    "context" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_status" "AuthzReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewed_by_admin_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,

    CONSTRAINT "authorization_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "category" TEXT,
    "updated_by_admin_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "back_in_stock_requests" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "customer_id" TEXT,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "back_in_stock_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_jobs" (
    "id" TEXT NOT NULL,
    "kind" "BulkJobKind" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT,
    "total_count" INTEGER NOT NULL,
    "succeeded_count" INTEGER,
    "failed_count" INTEGER,
    "status" "BulkJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "reason" VARCHAR(500),
    "inputs" JSONB NOT NULL,
    "results" JSONB,
    "idempotency_key" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "bulk_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_duplicates" (
    "id" TEXT NOT NULL,
    "attempted_source_type" "DuplicateSourceType" NOT NULL,
    "attempted_natural_key" JSONB NOT NULL,
    "duplicate_of_source_type" "DuplicateSourceType" NOT NULL,
    "duplicate_of_source_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "banner_url" TEXT,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "parent_id" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_return_window_days" INTEGER,
    "is_returnable" BOOLEAN NOT NULL DEFAULT true,
    "default_allowed_reasons_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_audit_logs" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "action" "CategoryAuditAction" NOT NULL,
    "admin_id" TEXT,
    "previous_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "logo_public_id" TEXT,
    "description" TEXT,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_audit_logs" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "action" "BrandAuditAction" NOT NULL,
    "admin_id" TEXT,
    "previous_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GENERIC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_values" (
    "id" TEXT NOT NULL,
    "option_definition_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "display_value" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_option_templates" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "option_definition_id" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_option_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "product_code" TEXT,
    "seller_id" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "category_id" TEXT,
    "brand_id" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "moderation_status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "moderation_note" TEXT,
    "sport" TEXT,
    "moderator_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "change_request_note" TEXT,
    "has_variants" BOOLEAN NOT NULL DEFAULT false,
    "product_source" "ProductSource" NOT NULL DEFAULT 'SELLER',
    "own_brand_sku" TEXT,
    "procurement_price" DECIMAL(10,2),
    "base_price" DECIMAL(10,2),
    "compare_at_price" DECIMAL(10,2),
    "cost_price" DECIMAL(10,2),
    "base_sku" TEXT,
    "base_stock" INTEGER,
    "base_barcode" TEXT,
    "weight" DECIMAL(10,3),
    "weight_unit" TEXT DEFAULT 'kg',
    "length" DECIMAL(10,2),
    "width" DECIMAL(10,2),
    "height" DECIMAL(10,2),
    "dimension_unit" TEXT DEFAULT 'cm',
    "return_policy" TEXT,
    "warranty_info" TEXT,
    "is_returnable" BOOLEAN NOT NULL DEFAULT true,
    "non_returnable_reason" TEXT,
    "return_window_days_override" INTEGER,
    "allowed_return_reasons_json" JSONB,
    "allow_partial_return" BOOLEAN NOT NULL DEFAULT true,
    "hsn_code" TEXT,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "supply_taxability" "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE',
    "tax_inclusive_pricing" BOOLEAN NOT NULL DEFAULT true,
    "cess_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "default_uqc_code" TEXT,
    "tax_category" TEXT,
    "tax_config_updated_by" TEXT,
    "tax_config_updated_at" TIMESTAMP(3),
    "tax_config_verified" BOOLEAN NOT NULL DEFAULT false,
    "tax_config_verified_at" TIMESTAMP(3),
    "tax_config_verified_by" TEXT,
    "tax_config_version" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "ai_generated_at" TIMESTAMP(3),
    "ai_prompt_version" TEXT,
    "ai_human_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_attestation_logs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "action" "TaxAttestationAction" NOT NULL,
    "prev_hsn" TEXT,
    "prev_gst_rate_bps" INTEGER,
    "prev_supply_taxability" TEXT,
    "prev_uqc_code" TEXT,
    "new_hsn" TEXT,
    "new_gst_rate_bps" INTEGER,
    "new_supply_taxability" TEXT,
    "new_uqc_code" TEXT,
    "tax_config_version" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "reviewer_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_attestation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "option_definition_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "option_value_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "master_sku" TEXT,
    "title" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "procurement_price" DECIMAL(10,2),
    "compare_at_price" DECIMAL(10,2),
    "cost_price" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "weight" DECIMAL(10,3),
    "weight_unit" TEXT DEFAULT 'kg',
    "length" DECIMAL(10,2),
    "width" DECIMAL(10,2),
    "height" DECIMAL(10,2),
    "dimension_unit" TEXT DEFAULT 'cm',
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "gst_rate_bps_override" INTEGER,
    "hsn_code_override" TEXT,
    "tax_inclusive_pricing_override" BOOLEAN,
    "uqc_code_override" TEXT,
    "option_fingerprint" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_option_values" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "option_value_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "delete_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_delete_error" TEXT,
    "delete_failed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_images" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "delete_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_delete_error" TEXT,
    "delete_failed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_variant_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_seo" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "handle" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_seo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "image_public_id" TEXT,
    "image_alt_text" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collection_maps" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_collection_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_audit_logs" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "action" "CollectionAuditAction" NOT NULL,
    "admin_id" TEXT,
    "previous_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_status_history" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_code_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_code_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metafield_definitions" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "MetafieldType" NOT NULL,
    "validations" JSONB,
    "choices" JSONB,
    "owner_type" TEXT NOT NULL DEFAULT 'CATEGORY',
    "category_id" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_filterable" BOOLEAN NOT NULL DEFAULT false,
    "default_filter_type" TEXT,
    "default_filter_label" TEXT,
    "filter_display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metafield_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metafield_definition_audit_logs" (
    "id" TEXT NOT NULL,
    "metafield_definition_id" TEXT NOT NULL,
    "action" "MetafieldDefinitionAuditAction" NOT NULL,
    "admin_id" TEXT,
    "previous_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metafield_definition_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_metafields" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "metafield_definition_id" TEXT NOT NULL,
    "value_text" TEXT,
    "value_numeric" DECIMAL(15,4),
    "value_boolean" BOOLEAN,
    "value_date" TIMESTAMP(3),
    "value_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_metafields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_filters" (
    "id" TEXT NOT NULL,
    "metafield_definition_id" TEXT,
    "built_in_type" TEXT,
    "label" TEXT NOT NULL,
    "filter_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "scope_type" TEXT,
    "scope_id" TEXT,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "show_counts" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_filters_pkey" PRIMARY KEY ("id")
);

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
    "refund_reference" TEXT,
    "last_polled_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_rules" (
    "id" TEXT NOT NULL,
    "kind" "CodRuleKind" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cod_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_decision_logs" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "pincode" TEXT,
    "seller_id" TEXT,
    "order_total_inr" DECIMAL(10,2),
    "order_total_in_paise" BIGINT,
    "eligible" BOOLEAN NOT NULL,
    "decided_by" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_batches" (
    "id" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "batch_number" TEXT,
    "exported_at" TIMESTAMP(3),
    "export_file_id" TEXT,
    "response_file_id" TEXT,
    "file_hash" TEXT,
    "total_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "settlement_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "utr_reference" TEXT,
    "failure_reason" TEXT,
    "bank_paid_amount_in_paise" BIGINT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_response_imports" (
    "id" TEXT NOT NULL,
    "payout_batch_id" TEXT NOT NULL,
    "imported_by_admin_id" TEXT,
    "source" "BankResponseSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "file_hash" TEXT,
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_response_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_response_rows" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "raw_json" JSONB NOT NULL,
    "settlement_id" TEXT,
    "outcome" TEXT NOT NULL,
    "utr_reference" TEXT,
    "failure_reason" TEXT,
    "bank_paid_amount_in_paise" BIGINT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_response_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "commission_type" "CommissionType" NOT NULL DEFAULT 'MARGIN_BASED',
    "commission_value" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "second_commission_value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fixed_commission_type" TEXT NOT NULL DEFAULT 'Product',
    "enable_max_commission" BOOLEAN NOT NULL DEFAULT false,
    "max_commission_amount" DECIMAL(10,2),
    "commission_value_in_paise" BIGINT NOT NULL DEFAULT 0,
    "second_commission_value_in_paise" BIGINT NOT NULL DEFAULT 0,
    "max_commission_amount_in_paise" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_records" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "order_number" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "platform_price" DECIMAL(10,2) NOT NULL,
    "settlement_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total_platform_amount" DECIMAL(10,2) NOT NULL,
    "total_settlement_amount" DECIMAL(10,2) NOT NULL,
    "platform_margin" DECIMAL(10,2) NOT NULL,
    "platform_price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "settlement_price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_platform_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_settlement_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "platform_margin_in_paise" BIGINT NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "commission_type" "CommissionType" NOT NULL,
    "commission_rate" TEXT NOT NULL,
    "unit_commission" DECIMAL(10,2) NOT NULL,
    "total_commission" DECIMAL(10,2) NOT NULL,
    "admin_earning" DECIMAL(10,2) NOT NULL,
    "product_earning" DECIMAL(10,2) NOT NULL,
    "refunded_admin_earning" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "vat_on_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shipping_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unit_price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "unit_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "admin_earning_in_paise" BIGINT NOT NULL DEFAULT 0,
    "product_earning_in_paise" BIGINT NOT NULL DEFAULT 0,
    "refunded_admin_earning_in_paise" BIGINT NOT NULL DEFAULT 0,
    "vat_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tax_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "CommissionRecordStatus" NOT NULL DEFAULT 'PENDING',
    "settlement_id" TEXT,
    "adjusted_by" TEXT,
    "adjusted_at" TIMESTAMP(3),
    "adjustment_reason" TEXT,
    "original_admin_earning" DECIMAL(10,2),
    "original_admin_earning_in_paise" BIGINT,
    "is_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processed_by" TEXT,
    "commission_rate_bps" INTEGER,
    "settlable_at" TIMESTAMP(3),
    "unfrozen_at" TIMESTAMP(3),
    "held_by_admin_id" TEXT,
    "held_at" TIMESTAMP(3),
    "hold_reason" TEXT,
    "previous_status" "CommissionRecordStatus",
    "resumed_by_admin_id" TEXT,
    "resumed_at" TIMESTAMP(3),
    "resume_reason" TEXT,

    CONSTRAINT "commission_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_reversal_records" (
    "id" TEXT NOT NULL,
    "commission_record_id" TEXT NOT NULL,
    "source" "CommissionReversalSource" NOT NULL DEFAULT 'RETURN_QC',
    "return_id" TEXT,
    "return_number" TEXT,
    "reversed_qty" INTEGER NOT NULL,
    "total_refund_amount" DECIMAL(10,2) NOT NULL,
    "refunded_admin_earning" DECIMAL(10,2) NOT NULL,
    "total_refund_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "refunded_admin_earning_in_paise" BIGINT NOT NULL DEFAULT 0,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_reversal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_hold_history" (
    "id" TEXT NOT NULL,
    "commission_record_id" TEXT NOT NULL,
    "action" "CommissionHoldAction" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "from_status" "CommissionRecordStatus" NOT NULL,
    "to_status" "CommissionRecordStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "related_return_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_hold_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_adjustment_history" (
    "id" TEXT NOT NULL,
    "commission_record_id" TEXT NOT NULL,
    "from_admin_earning" DECIMAL(10,2) NOT NULL,
    "to_admin_earning" DECIMAL(10,2) NOT NULL,
    "from_platform_margin" DECIMAL(10,2) NOT NULL,
    "to_platform_margin" DECIMAL(10,2) NOT NULL,
    "admin_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_adjustment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_failures" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "slot" "BannerSlot" NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "cta_url" TEXT,
    "scope_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "static_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "meta_title" TEXT,
    "meta_desc" TEXT,
    "canonical_url" TEXT,
    "og_image" TEXT,
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "deleted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "static_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_page_audit_logs" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_title" TEXT,
    "prev_body" TEXT,
    "new_title" TEXT,
    "new_body" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_page_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_content_blocks" (
    "id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "image_url" TEXT,
    "image_public_id" TEXT,
    "image_alt" TEXT,
    "eyebrow" TEXT,
    "headline" TEXT,
    "subhead" TEXT,
    "cta_label" TEXT,
    "cta_href" TEXT,
    "price" TEXT,
    "price_caption" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "image_url_mobile" TEXT,
    "device_visibility" "StorefrontDeviceVisibility" NOT NULL DEFAULT 'ALL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "content_html" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT,
    "image_public_id" TEXT,
    "image_alt" TEXT,
    "author" TEXT,
    "category" TEXT NOT NULL DEFAULT 'News',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BlogPostStatus" NOT NULL DEFAULT 'HIDDEN',
    "published_at" TIMESTAMP(3),
    "meta_title" TEXT,
    "meta_desc" TEXT,
    "canonical_url" TEXT,
    "og_image" TEXT,
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post_audit_logs" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_state" JSONB,
    "new_state" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_post_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_slot_definitions" (
    "id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "default_href" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_slot_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_audit_logs" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_state" JSONB,
    "new_state" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_entries" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "slug" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "CronRunStatus" NOT NULL DEFAULT 'RUNNING',
    "duration_ms" INTEGER,
    "error" TEXT,
    "result" JSONB,

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_heartbeat_targets" (
    "job_name" TEXT NOT NULL,
    "expected_interval_seconds" INTEGER NOT NULL,
    "tolerance_multiplier" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_heartbeat_targets_pkey" PRIMARY KEY ("job_name")
);

-- CreateTable
CREATE TABLE "customer_abuse_counters" (
    "customer_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "orders_last_90d" INTEGER NOT NULL DEFAULT 0,
    "returns_last_90d" INTEGER NOT NULL DEFAULT 0,
    "disputes_last_90d" INTEGER NOT NULL DEFAULT 0,
    "return_rate_bps" INTEGER,
    "requires_manual_approval" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_abuse_counters_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "data_erasure_requests" (
    "id" TEXT NOT NULL,
    "subject_type" "ErasureSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_email_snapshot" TEXT,
    "status" "ErasureStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'USER_REQUEST',
    "requested_by_actor_type" TEXT,
    "requested_by_actor_id" TEXT,
    "not_before" TIMESTAMP(3) NOT NULL,
    "processing_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "outcome" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_erasure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT,
    "type" "DiscountType" NOT NULL,
    "method" "DiscountMethod" NOT NULL DEFAULT 'CODE',
    "value_type" "DiscountValueType" NOT NULL DEFAULT 'PERCENTAGE',
    "value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "applies_to" "DiscountAppliesTo" NOT NULL DEFAULT 'ALL_PRODUCTS',
    "eligibility" TEXT NOT NULL DEFAULT 'ALL_CUSTOMERS',
    "min_requirement" "DiscountMinRequirement" NOT NULL DEFAULT 'NONE',
    "min_requirement_value" DECIMAL(10,2),
    "max_uses" INTEGER,
    "one_per_customer" BOOLEAN NOT NULL DEFAULT false,
    "combine_product" BOOLEAN NOT NULL DEFAULT false,
    "combine_order" BOOLEAN NOT NULL DEFAULT false,
    "combine_shipping" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "status" "DiscountStatus" NOT NULL DEFAULT 'ACTIVE',
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "buy_type" TEXT,
    "buy_value" DECIMAL(10,2),
    "buy_items_from" TEXT,
    "get_quantity" INTEGER,
    "get_items_from" TEXT,
    "get_discount_type" "BxgyGetDiscountType",
    "get_discount_value" DECIMAL(10,2),
    "max_uses_per_order" INTEGER,
    "funding_type" "DiscountFundingType" NOT NULL DEFAULT 'PLATFORM',
    "platform_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "seller_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "brand_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "franchise_funding_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commission_basis" "DiscountCommissionBasis" NOT NULL DEFAULT 'GROSS',
    "funding_notes" TEXT,
    "funding_franchise_id" TEXT,
    "funding_brand_id" TEXT,
    "discount_nature" "DiscountNature" NOT NULL DEFAULT 'TRANSACTIONAL',
    "tax_treatment" "DiscountTaxTreatment" NOT NULL DEFAULT 'PRE_SUPPLY_TRANSACTIONAL',
    "affiliate_id" TEXT,
    "affiliate_commission_percent" DECIMAL(5,2),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "max_discount_amount_in_paise" BIGINT,
    "description_long" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_products" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'APPLIES',

    CONSTRAINT "discount_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_collections" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'APPLIES',

    CONSTRAINT "discount_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "DiscountCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "assigned_customer_id" TEXT,
    "assigned_affiliate_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "customer_id" TEXT NOT NULL,
    "master_order_id" TEXT,
    "source" "DiscountSource" NOT NULL DEFAULT 'CODE',
    "status" "DiscountRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_discounts" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "discount_type" "DiscountType" NOT NULL,
    "discount_method" "DiscountMethod" NOT NULL,
    "discount_nature" "DiscountNature" NOT NULL DEFAULT 'TRANSACTIONAL',
    "source" "DiscountSource" NOT NULL DEFAULT 'CODE',
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "funding_type" "DiscountFundingType" NOT NULL DEFAULT 'PLATFORM',
    "funding_config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_discounts" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "discount_type" "DiscountType" NOT NULL,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "funding_type" "DiscountFundingType" NOT NULL DEFAULT 'PLATFORM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_liability_ledger" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT,
    "order_item_id" TEXT,
    "seller_id" TEXT,
    "franchise_id" TEXT,
    "brand_id" TEXT,
    "discount_id" TEXT NOT NULL,
    "discount_code_id" TEXT,
    "discount_code" TEXT,
    "funding_type" "DiscountFundingType" NOT NULL,
    "liability_party" "DiscountLiabilityParty" NOT NULL,
    "amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "DiscountLiabilityStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "idempotency_key" TEXT,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "settlement_cycle_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_liability_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_eligibility_rules" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "rule_type" "DiscountEligibilityRuleType" NOT NULL,
    "operator" TEXT,
    "value_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_eligibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_attempts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "ip_address" TEXT,
    "ip_hash" TEXT,
    "device_id" TEXT,
    "code_attempted" TEXT NOT NULL,
    "result" "CouponAttemptResult" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "dispute_number" TEXT NOT NULL,
    "kind" "DisputeKind" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "severity" INTEGER NOT NULL DEFAULT 50,
    "master_order_id" TEXT,
    "sub_order_id" TEXT,
    "return_id" TEXT,
    "source_ticket_id" TEXT,
    "filed_by_type" "DisputeActorType" NOT NULL,
    "filed_by_id" TEXT NOT NULL,
    "filed_by_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "assigned_admin_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "assigned_by_admin_id" TEXT,
    "decision_by_admin_id" TEXT,
    "decision_at" TIMESTAMP(3),
    "decision_rationale" TEXT,
    "decision_amount_in_paise" INTEGER,
    "liability_party" "LiabilityParty",
    "customer_remedy" "CustomerRemedy",
    "previous_decision_at" TIMESTAMP(3),
    "previous_decision_rationale" TEXT,
    "finance_rejection_reason" TEXT,
    "finance_rejected_at" TIMESTAMP(3),
    "reroute_due_by" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "sender_type" "DisputeActorType" NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "mirrored_from_ticket_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "caption" TEXT,
    "uploaded_by_type" "DisputeActorType" NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dispute_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e_way_bills" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "tax_document_id" TEXT,
    "supplier_gstin" TEXT,
    "ewb_number" TEXT,
    "ewb_date" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'stub',
    "transport_mode" "EWayBillTransportMode" NOT NULL DEFAULT 'ROAD',
    "vehicle_number" TEXT,
    "transporter_id" TEXT,
    "transporter_name" TEXT,
    "from_pincode" TEXT,
    "from_state_code" TEXT,
    "to_pincode" TEXT,
    "to_state_code" TEXT,
    "distance_km" INTEGER,
    "consignment_value_in_paise" BIGINT NOT NULL,
    "status" "EWayBillStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_initiated_at" TIMESTAMP(3),
    "cancel_initiated_by" TEXT,
    "provider_cancel_reference" TEXT,
    "raw_request_json" JSONB,
    "raw_response_json" JSONB,
    "raw_cancel_response_json" JSONB,
    "override_admin_id" TEXT,
    "override_at" TIMESTAMP(3),
    "override_reason" TEXT,
    "override_reason_category" TEXT,
    "pre_override_status" "EWayBillStatus",
    "override_revoked_at" TIMESTAMP(3),
    "override_revoked_by" TEXT,
    "override_revoke_reason" TEXT,
    "threshold_applied_in_paise" BIGINT,
    "policy_version" TEXT,
    "replaced_eway_bill_id" TEXT,
    "pdf_url" TEXT,
    "pdf_rendered_at" TIMESTAMP(3),
    "nic_ack_no" TEXT,
    "nic_ack_date" TIMESTAMP(3),
    "retention_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "e_way_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e_way_bill_audit_logs" (
    "id" TEXT NOT NULL,
    "eway_bill_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "EWayBillStatus",
    "to_status" "EWayBillStatus",
    "actor_id" TEXT,
    "actor_role" TEXT,
    "reason" TEXT,
    "payload_before" JSONB,
    "payload_after" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e_way_bill_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_url_audits" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "requester_role" TEXT,
    "requester_type" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3),
    "ttl_seconds" INTEGER NOT NULL,
    "denied" BOOLEAN NOT NULL DEFAULT false,
    "deny_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_url_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_metadata" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "classification" "FileClassification" NOT NULL,
    "purpose" "FilePurpose" NOT NULL DEFAULT 'OTHER',
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'r2',
    "provider_file_id" TEXT,
    "provider_url" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_by_type" TEXT,
    "expires_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "content_sha256" TEXT,
    "hash_algorithm" TEXT DEFAULT 'sha256',
    "hashed_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "caption" TEXT,
    "attached_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_evidence" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "kind" "shipment_evidence_kind_enum" NOT NULL,
    "file_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_by_role" "shipment_evidence_actor_enum" NOT NULL,
    "geo_lat" DECIMAL(10,7),
    "geo_lng" DECIMAL(10,7),
    "exif_json" JSONB,
    "perceptual_hash" TEXT,
    "content_sha256" TEXT,
    "courier_waybill" TEXT,
    "signature_blob" TEXT,
    "signed_by_name" TEXT,
    "customer_otp_hash" TEXT,
    "pending_upload" BOOLEAN NOT NULL DEFAULT true,
    "frozen_at" TIMESTAMP(3),
    "retention_expires_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deleted_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_evidence_audits" (
    "id" TEXT NOT NULL,
    "shipment_evidence_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" "shipment_evidence_actor_enum" NOT NULL,
    "reason" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_evidence_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_evidence_policies" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_match" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "packing_photos_min" INTEGER NOT NULL DEFAULT 4,
    "pod_required" BOOLEAN NOT NULL DEFAULT false,
    "signature_required" BOOLEAN NOT NULL DEFAULT false,
    "otp_required" BOOLEAN NOT NULL DEFAULT false,
    "retention_days" INTEGER NOT NULL DEFAULT 180,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_evidence_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_reversals" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "status" "FranchiseReversalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "reversal_value_in_paise" BIGINT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_admin_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "finance_ledger_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_reversal_items" (
    "id" TEXT NOT NULL,
    "reversal_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_in_paise" BIGINT NOT NULL,

    CONSTRAINT "franchise_reversal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_partners" (
    "id" TEXT NOT NULL,
    "franchise_code" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "entity_type" "BusinessEntityType",
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "FranchiseStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "FranchiseVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "ledger_balance_in_paise" BIGINT NOT NULL DEFAULT 0,
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "pincode" TEXT,
    "locality" TEXT,
    "country" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "gst_state_code" TEXT,
    "pan_last_4" TEXT,
    "pan_verified" BOOLEAN NOT NULL DEFAULT false,
    "pan_verified_at" TIMESTAMP(3),
    "gst_verified" BOOLEAN NOT NULL DEFAULT false,
    "gst_verified_at" TIMESTAMP(3),
    "gstn_portal_status" TEXT,
    "gst_legal_name" TEXT,
    "legal_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "gst_verification_failure_reason" TEXT,
    "kyc_submitted_at" TIMESTAMP(3),
    "kyc_submitted_payload_json" JSONB,
    "kyc_confirmed_accurate_at" TIMESTAMP(3),
    "verification_reviewed_at" TIMESTAMP(3),
    "verification_reviewed_by" TEXT,
    "verification_rejection_reason" TEXT,
    "verification_approval_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "activated_at" TIMESTAMP(3),
    "activated_by" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspended_by" TEXT,
    "suspension_reason" TEXT,
    "deactivated_at" TIMESTAMP(3),
    "deactivated_by" TEXT,
    "deactivation_reason" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "online_fulfillment_rate" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "procurement_fee_rate" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "contract_start_date" TIMESTAMP(3),
    "contract_end_date" TIMESTAMP(3),
    "warehouse_address" TEXT,
    "warehouse_pincode" TEXT,
    "warehouse_city" TEXT,
    "warehouse_state" TEXT,
    "warehouse_locality" TEXT,
    "warehouse_country" TEXT,
    "dispatch_sla_days" INTEGER NOT NULL DEFAULT 1,
    "cod_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fulfillment_hold" BOOLEAN NOT NULL DEFAULT false,
    "fulfillment_hold_reason" TEXT,
    "fulfillment_hold_at" TIMESTAMP(3),
    "fulfillment_hold_by" TEXT,
    "self_delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
    "self_delivery_pincodes" JSONB,
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
CREATE TABLE "franchise_partner_registrations" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "partner" VARCHAR(32) NOT NULL,
    "warehouse_name" VARCHAR(128),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "registered_at" TIMESTAMP(3),
    "registered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_partner_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_status_history" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "changed_by_admin_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_verification_events" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "changed_by_admin_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_procurement_prices" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "landed_unit_cost" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_procurement_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_procurement_price_history" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "action" TEXT NOT NULL,
    "old_landed_unit_cost" DECIMAL(10,2),
    "new_landed_unit_cost" DECIMAL(10,2),
    "change_reason" TEXT,
    "changed_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_procurement_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pincode_mappings" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "assigned_by_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by_id" TEXT,
    "removed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_pincode_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pincode_mapping_events" (
    "id" TEXT NOT NULL,
    "mapping_id" TEXT,
    "franchise_id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_pincode_mapping_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_sessions" (
    "id" TEXT NOT NULL,
    "franchise_partner_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "device_label" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_bank_details" (
    "id" TEXT NOT NULL,
    "franchise_partner_id" TEXT NOT NULL,
    "account_holder_name" VARCHAR(150) NOT NULL,
    "account_number_enc" TEXT NOT NULL,
    "account_number_last_4" VARCHAR(4) NOT NULL,
    "ifsc_code" VARCHAR(11) NOT NULL,
    "bank_name" VARCHAR(150),
    "upi_vpa" VARCHAR(100),
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_bank_details_pkey" PRIMARY KEY ("id")
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
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "stopped_by_id" TEXT,
    "stopped_at" TIMESTAMP(3),
    "stop_reason" TEXT,
    "removed_by_id" TEXT,
    "removed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_catalog_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_catalog_mapping_events" (
    "id" TEXT NOT NULL,
    "mapping_id" TEXT,
    "franchise_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "actor_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_catalog_mapping_events_pkey" PRIMARY KEY ("id")
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
    "requested_by_staff_id" TEXT,
    "dispatched_by" TEXT,
    "received_by" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "sla_approve_by" TIMESTAMP(3),
    "sla_breached_at" TIMESTAMP(3),
    "tracking_number" TEXT,
    "carrier_name" TEXT,
    "expected_delivery_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_request_events" (
    "id" TEXT NOT NULL,
    "procurement_request_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_request_events_pkey" PRIMARY KEY ("id")
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
    "mrp_snapshot" DECIMAL(10,2),
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
    "sale_type" "PosSaleType" NOT NULL DEFAULT 'WALK_IN',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "gross_amount" DECIMAL(10,2) NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(10,2) NOT NULL,
    "cgst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "place_of_supply_state" TEXT,
    "payment_method" "PosPaymentMethod" NOT NULL DEFAULT 'CASH',
    "status" "PosSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "payment_status" "PosPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "payment_reference" TEXT,
    "payment_settled_at" TIMESTAMP(3),
    "tax_invoice_status" "PosTaxInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "tax_invoice_id" TEXT,
    "commission_rate" DECIMAL(5,2),
    "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_staff_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "voided_by" TEXT,
    "returned_at" TIMESTAMP(3),
    "returned_by" TEXT,
    "return_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pos_returns" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "refund_amount" DECIMAL(10,2) NOT NULL,
    "refund_method" "PosRefundMethod" NOT NULL,
    "refund_reference" TEXT,
    "return_reason" TEXT,
    "returned_by" TEXT,
    "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_pos_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pos_return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "sale_item_id" TEXT NOT NULL,
    "return_qty" INTEGER NOT NULL,
    "condition" "PosReturnItemCondition" NOT NULL DEFAULT 'SALEABLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_pos_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_pos_reconciliations" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "expected_cash_in_paise" BIGINT NOT NULL,
    "actual_cash_in_paise" BIGINT NOT NULL,
    "bank_deposit_in_paise" BIGINT NOT NULL DEFAULT 0,
    "bank_deposit_reference" VARCHAR(64),
    "variance_in_paise" BIGINT NOT NULL,
    "expected_snapshot_json" JSONB,
    "status" "PosReconciliationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "submitted_by_staff_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_admin_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "resolution_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_pos_reconciliations_pkey" PRIMARY KEY ("id")
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
    "returned_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "line_discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(10,2) NOT NULL,
    "hsn_code" TEXT,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
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
    "debit_in_paise" BIGINT NOT NULL DEFAULT 0,
    "credit_in_paise" BIGINT NOT NULL DEFAULT 0,
    "balance_after_in_paise" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_by_admin_id" TEXT,
    "created_by_system" BOOLEAN NOT NULL DEFAULT true,
    "idempotency_key" TEXT,
    "status" "FranchiseLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "settlement_batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_finance_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_ledger_status_history" (
    "id" TEXT NOT NULL,
    "ledger_entry_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "actor_admin_id" TEXT,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_ledger_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_penalty_approvals" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FranchisePenaltyApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_admin_id" TEXT NOT NULL,
    "approved_by_admin_id" TEXT,
    "decision_reason" TEXT,
    "ledger_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "franchise_penalty_approvals_pkey" PRIMARY KEY ("id")
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
    "tcs_ledger_id" TEXT,
    "tcs_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tcs_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
    "tcs_filing_period" TEXT,
    "tds_ledger_id" TEXT,
    "tds_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tds_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
    "tds_filing_period" TEXT,
    "tds_skip_reason" TEXT,
    "commission_gst_rate_bps" INTEGER NOT NULL DEFAULT 1800,
    "commission_gst_split_type" TEXT,
    "cgst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_commission_gst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "commission_gst_marketplace_state_code" TEXT,
    "commission_gst_franchise_state_code" TEXT,
    "status" "FranchiseSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_admin_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "payment_method" TEXT,
    "payment_proof_url" TEXT,
    "paid_by_admin_id" TEXT,
    "payout_due_by" TIMESTAMP(3),
    "hold_reason" TEXT,
    "frozen_at" TIMESTAMP(3),
    "frozen_by_admin_id" TEXT,
    "paid_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "dynamic_charge_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "charge_rules_applied" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_settlement_charge_lines" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "rule_name" TEXT NOT NULL,
    "base_type" TEXT NOT NULL,
    "base_rule_id" TEXT,
    "base_amount_in_paise" BIGINT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "amount_in_paise" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_settlement_charge_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_settlement_adjustments" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "adjustment_type" "SettlementAdjustmentType" NOT NULL DEFAULT 'MANUAL_CORRECTION',
    "status" "SettlementAdjustmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by_admin_id" TEXT,
    "voided_by_admin_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_settlement_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_staff" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "role" "FranchiseStaffRole" NOT NULL DEFAULT 'POS_OPERATOR',
    "status" "FranchiseStaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "permissions" JSONB,
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "created_by" TEXT,
    "suspended_by" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_staff_sessions" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchise_staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_tcs_settlement_ledger" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT,
    "filing_period" TEXT NOT NULL,
    "party_type" "SupplierType" NOT NULL DEFAULT 'MARKETPLACE_SELLER',
    "franchise_id" TEXT,
    "supplier_gstin" TEXT,
    "supplier_state_code" TEXT,
    "gross_taxable_supply_in_paise" BIGINT NOT NULL DEFAULT 0,
    "credit_note_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "net_taxable_supply_in_paise" BIGINT NOT NULL DEFAULT 0,
    "intra_state_taxable_in_paise" BIGINT NOT NULL DEFAULT 0,
    "inter_state_taxable_in_paise" BIGINT NOT NULL DEFAULT 0,
    "place_of_supply_breakdown_json" JSONB NOT NULL DEFAULT '[]',
    "tcs_rate_bps" INTEGER NOT NULL DEFAULT 100,
    "cgst_tcs_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_tcs_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_tcs_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tcs_in_paise" BIGINT NOT NULL DEFAULT 0,
    "adjustment_carried_forward_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "TcsStatus" NOT NULL DEFAULT 'COMPUTED',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" TEXT,
    "computed_reason" TEXT,
    "collected_at" TIMESTAMP(3),
    "settlement_id" TEXT,
    "filed_at" TIMESTAMP(3),
    "filed_by" TEXT,
    "nic_arn" TEXT,
    "paid_to_govt_at" TIMESTAMP(3),
    "paid_by" TEXT,
    "payment_reference" TEXT,
    "payment_proof_file_id" TEXT,
    "certificate_number" TEXT,
    "certificate_issued_at" TIMESTAMP(3),
    "certificate_issued_by" TEXT,
    "certificate_storage_key" TEXT,
    "certificate_url" TEXT,
    "compute_warnings_json" JSONB NOT NULL DEFAULT '[]',
    "correction_of_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_tcs_settlement_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_tcs_ledger_event" (
    "id" TEXT NOT NULL,
    "ledger_id" TEXT NOT NULL,
    "event_type" "TcsLedgerEventType" NOT NULL,
    "from_status" "TcsStatus",
    "to_status" "TcsStatus" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gst_tcs_ledger_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "i18n_messages" (
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "short_body" TEXT,
    "description" TEXT,
    "updated_by_actor_type" TEXT,
    "updated_by_actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "i18n_messages_pkey" PRIMARY KEY ("locale","key")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" "IdempotencyKeyState" NOT NULL DEFAULT 'PENDING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" "UserRole" NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "user_agent" VARCHAR(512),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "device_label" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_otps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_otps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "consent_version" TEXT,
    "source" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_194o_tds_ledger" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT,
    "party_type" "SupplierType" NOT NULL DEFAULT 'MARKETPLACE_SELLER',
    "franchise_id" TEXT,
    "filing_period" TEXT NOT NULL,
    "seller_pan_number" TEXT,
    "seller_pan_last_4" TEXT,
    "seller_legal_name" TEXT,
    "had_verified_pan" BOOLEAN NOT NULL DEFAULT false,
    "gross_sale_in_paise" BIGINT NOT NULL DEFAULT 0,
    "refund_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "net_sale_in_paise" BIGINT NOT NULL DEFAULT 0,
    "adjustment_carried_forward_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tds_rate_bps" INTEGER NOT NULL DEFAULT 100,
    "tds_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "Tds194OStatus" NOT NULL DEFAULT 'COMPUTED',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" TEXT,
    "computed_reason" TEXT,
    "withheld_at" TIMESTAMP(3),
    "settlement_id" TEXT,
    "deposited_at" TIMESTAMP(3),
    "deposited_by" TEXT,
    "challan_reference" TEXT,
    "certificate_issued_at" TIMESTAMP(3),
    "certificate_issued_by" TEXT,
    "certificate_number" TEXT,
    "correction_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_194o_tds_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_poller_checkpoints" (
    "poller_key" TEXT NOT NULL,
    "last_polled_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_poller_checkpoints_pkey" PRIMARY KEY ("poller_key")
);

-- CreateTable
CREATE TABLE "seller_debits" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "order_id" TEXT,
    "sub_order_id" TEXT,
    "amount_in_paise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SellerDebitStatus" NOT NULL DEFAULT 'PENDING',
    "settlement_adjusted_at" TIMESTAMP(3),
    "settlement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_debits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_claims" (
    "id" TEXT NOT NULL,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "courier_name" TEXT,
    "awb_number" TEXT,
    "amount_in_paise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LogisticsClaimStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMP(3),
    "recovered_at" TIMESTAMP(3),
    "evidence_file_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_expenses" (
    "id" TEXT NOT NULL,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "expense_type" "PlatformExpenseType" NOT NULL,
    "amount_in_paise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_tasks" (
    "id" TEXT NOT NULL,
    "kind" "AdminTaskKind" NOT NULL,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" "AdminTaskStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "assigned_to" TEXT,
    "claimed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "sla_breach_at" TIMESTAMP(3),
    "sla_breached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sales" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "members_only" BOOLEAN NOT NULL DEFAULT false,
    "collection_slug" TEXT,
    "waitlist_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "city" TEXT,
    "description" TEXT,
    "url" TEXT,
    "is_member_free" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sport_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dlt_template_id" TEXT,
    "dlt_header_id" TEXT,
    "variables_schema" JSONB,
    "customer_visible_only" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_admin_id" TEXT,
    "updated_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_template_history" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "change_type" TEXT NOT NULL,
    "changed_by_admin_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_template_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_class" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "updated_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_class" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "old_enabled" BOOLEAN,
    "new_enabled" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "updated_by_admin_id" TEXT,
    "bypass_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preference_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_suppressions" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "added_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "customer_id" TEXT,
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "opt_out_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_inbound" (
    "id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "from_phone_e164" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "text_body" TEXT,
    "is_opt_out_signal" BOOLEAN NOT NULL DEFAULT false,
    "media_id" TEXT,
    "media_mime_type" TEXT,
    "replied_to_message_id" TEXT,
    "contact_name" TEXT,
    "customer_id" TEXT,
    "waba_id" TEXT,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_statuses" (
    "id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" "WhatsappDeliveryStatus" NOT NULL,
    "recipient_id" TEXT,
    "error_code" TEXT,
    "error_title" TEXT,
    "waba_id" TEXT,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "recipient_id" TEXT,
    "destination" TEXT NOT NULL,
    "template_key" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "event_type" TEXT,
    "event_id" TEXT,
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "provider_response_summary" JSONB,
    "failure_code" "NotificationFailureCode",
    "provider" TEXT,
    "outbox_event_id" TEXT,
    "parent_log_id" TEXT,
    "trigger_source" TEXT,
    "delivered_at" TIMESTAMP(3),
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_dispatches" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "dispatched_by_admin_id" TEXT NOT NULL,
    "dispatch_path" "DispatchPath" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" TEXT,
    "event_class" TEXT,
    "raw_subject" TEXT,
    "raw_body" TEXT,
    "recipient_id" TEXT,
    "destination" TEXT,
    "bypass_opt_out" BOOLEAN NOT NULL DEFAULT false,
    "bypass_reason" TEXT,
    "alert_type" "AdminDispatchAlertType",
    "job_id" TEXT,
    "status" "NotificationDispatchStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "locality" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "state_code" TEXT,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "address_type" "AddressType",
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "saved_for_later" BOOLEAN NOT NULL DEFAULT false,
    "unit_price_at_add_in_paise" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "shipping_address_snapshot" JSONB NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "total_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "payment_method" "OrderPaymentMethod" NOT NULL DEFAULT 'COD',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "order_status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "verified_by" TEXT,
    "verification_remarks" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejection_reason" TEXT,
    "previous_payment_status" "OrderPaymentStatus",
    "gst_mode_snapshot" "GstMode",
    "paid_by" TEXT,
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "payment_notes" TEXT,
    "collected_amount_in_paise" BIGINT,
    "wallet_amount_used_in_paise" BIGINT NOT NULL DEFAULT 0,
    "wallet_transaction_id" TEXT,
    "claimed_by_admin_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "claim_expires_at" TIMESTAMP(3),
    "verification_deadline_at" TIMESTAMP(3),
    "verification_risk_score" INTEGER,
    "verification_risk_band" "OrderRiskBand",
    "verification_risk_reasons" JSONB,
    "verification_scored_at" TIMESTAMP(3),
    "verification_scored_by" TEXT,
    "verification_score_source" "OrderRiskScoreSource",
    "verification_score_version" INTEGER NOT NULL DEFAULT 1,
    "exception_reason" "AllocationExceptionReason",
    "exception_reason_detail" TEXT,
    "exception_entered_at" TIMESTAMP(3),
    "item_count" INTEGER NOT NULL,
    "discount_code" TEXT,
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_option_id" TEXT,
    "shipping_option_name" TEXT,
    "shipping_fee_in_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_option_price_in_paise_snapshot" BIGINT,
    "shipping_option_rate_type_snapshot" TEXT,
    "shipping_option_threshold_in_paise_snapshot" BIGINT,
    "shipping_zone_id_snapshot" TEXT,
    "shipping_surcharges_json_snapshot" JSONB,
    "shipping_taxable_in_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_cgst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_sgst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_igst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "selected_tax_profile_id" TEXT,
    "customer_tax_profile_snapshot" JSONB,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "payment_expires_at" TIMESTAMP(3),
    "gateway_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "last_failed_payment_id" TEXT,
    "last_payment_failure_code" TEXT,
    "last_payment_failure_reason" TEXT,
    "last_payment_failure_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "poll_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_poll_error" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "idempotency_key" TEXT,
    "source_cart_id" TEXT,
    "source_cart_snapshot" JSONB,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_collections" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT,
    "expected_amount_in_paise" BIGINT NOT NULL,
    "collected_amount_in_paise" BIGINT NOT NULL,
    "variance_in_paise" BIGINT NOT NULL DEFAULT 0,
    "variance_reason" TEXT,
    "collection_reference" TEXT,
    "notes" TEXT,
    "collected_by_admin_id" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_orders" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "fulfillment_node_type" TEXT NOT NULL DEFAULT 'SELLER',
    "franchise_id" TEXT,
    "sub_total" DECIMAL(10,2) NOT NULL,
    "sub_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillment_status" "OrderFulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "seller_reversal_status" "SellerReversalStatus",
    "accept_status" "OrderAcceptStatus" NOT NULL DEFAULT 'OPEN',
    "accept_deadline_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "rejection_note" TEXT,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejection_type" "SubOrderRejectionType",
    "auto_rejected_at" TIMESTAMP(3),
    "expected_dispatch_date" TIMESTAMP(3),
    "packed_at" TIMESTAMP(3),
    "packed_by" TEXT,
    "shipped_at" TIMESTAMP(3),
    "shipped_by" TEXT,
    "delivered_at" TIMESTAMP(3),
    "delivered_by" TEXT,
    "delivery_source" "DeliveryConfirmationSource",
    "delivery_proof_url" TEXT,
    "delivery_otp_verified" BOOLEAN,
    "delivery_signature_url" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_by" TEXT,
    "payment_reference" TEXT,
    "commission_lock_scheduled_at" TIMESTAMP(3),
    "return_window_ends_at" TIMESTAMP(3),
    "tracking_number" TEXT,
    "courier_name" TEXT,
    "tracking_url" TEXT,
    "shipping_label_url" TEXT,
    "awb_attached_at" TIMESTAMP(3),
    "awb_attached_by" TEXT,
    "awb_attachment_source" "AwbAttachmentSource",
    "delivery_method" "DeliveryMethod",
    "self_delivery_status" "SelfDeliveryStatus",
    "self_delivered_at" TIMESTAMP(3),
    "self_delivery_notes" TEXT,
    "last_tracking_event_at" TIMESTAMP(3),
    "ndr_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "ndr_last_attempt_at" TIMESTAMP(3),
    "ndr_last_reason" TEXT,
    "ndr_last_reason_code" TEXT,
    "ndr_status" TEXT,
    "rto_initiated_at" TIMESTAMP(3),
    "rto_in_transit_at" TIMESTAMP(3),
    "rto_delivered_at" TIMESTAMP(3),
    "rto_reason" TEXT,
    "last_courier_status" TEXT,
    "last_courier_reason_code" TEXT,
    "pickup_address_id_snapshot" TEXT,
    "return_address_id_snapshot" TEXT,
    "commission_processed" BOOLEAN NOT NULL DEFAULT false,
    "commission_decision" "CommissionDecision" NOT NULL DEFAULT 'PENDING',
    "commission_rate_snapshot" DECIMAL(5,2),
    "reassignment_count" INTEGER NOT NULL DEFAULT 0,
    "last_reassigned_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "cancellation_source" "CancellationSource",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "sku" TEXT,
    "master_sku" TEXT,
    "image_url" TEXT,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "unit_price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "reversed_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_price" DECIMAL(10,2) NOT NULL,
    "total_price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stock_reservation_id" TEXT,
    "image_public_id" TEXT,
    "item_kind" "OrderItemKind" NOT NULL DEFAULT 'PHYSICAL',
    "is_returnable_snapshot" BOOLEAN NOT NULL DEFAULT true,
    "return_window_days_snapshot" INTEGER,
    "allowed_return_reasons_json_snapshot" JSONB,
    "allow_partial_return_snapshot" BOOLEAN NOT NULL DEFAULT true,
    "non_returnable_reason_snapshot" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_tax_config_snapshots" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "hsn_code" TEXT,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "supply_taxability" TEXT NOT NULL DEFAULT 'TAXABLE',
    "price_includes_tax" BOOLEAN NOT NULL DEFAULT true,
    "cess_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "uqc_code" TEXT,
    "product_source" TEXT,
    "sourced_from_variant" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_tax_config_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_risk_rule_configs" (
    "id" TEXT NOT NULL,
    "reason_code" "OrderRiskReasonCode" NOT NULL,
    "score_delta" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mask_amounts" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "order_risk_rule_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_verification_decisions" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "decision" "OrderVerificationDecisionType" NOT NULL,
    "decided_by" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "remarks" TEXT,
    "metadata_json" JSONB,

    CONSTRAINT "order_verification_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_claim_history" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "claimed_by_admin_id" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_seconds" INTEGER NOT NULL,
    "release_reason" "OrderClaimReleaseReason" NOT NULL,
    "released_by_admin_id" TEXT,
    "reason_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_claim_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_risk_score_history" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "OrderRiskBand" NOT NULL,
    "reasons" JSONB NOT NULL,
    "source" "OrderRiskScoreSource" NOT NULL,
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scored_by" TEXT,
    "scorer_version" INTEGER NOT NULL,

    CONSTRAINT "order_risk_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_risk_reasons" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "reason_code" "OrderRiskReasonCode" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "score_delta" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_risk_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_reassignment_logs" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "from_node_type" TEXT NOT NULL DEFAULT 'SELLER',
    "to_node_type" TEXT NOT NULL DEFAULT 'SELLER',
    "from_node_id" TEXT,
    "to_node_id" TEXT,
    "from_seller_id" TEXT NOT NULL,
    "to_seller_id" TEXT,
    "reason" TEXT NOT NULL,
    "successful" BOOLEAN NOT NULL,
    "failure_reason" TEXT,
    "new_sub_order_id" TEXT,
    "reassigned_by" TEXT,
    "reassignment_sequence" INTEGER NOT NULL DEFAULT 1,
    "event_type" "OrderReassignmentEventType" NOT NULL DEFAULT 'ADMIN_MANUAL_OVERRIDE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_reassignment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT,
    "event_type" "OrderTimelineEventType" NOT NULL,
    "old_status" TEXT,
    "new_status" TEXT,
    "actor_type" "TimelineActorType" NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "visibility" "TimelineVisibility" NOT NULL DEFAULT 'ADMIN_ONLY',
    "note" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_order_awb_history" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "awb_number" TEXT NOT NULL,
    "courier_name" TEXT NOT NULL,
    "tracking_url" TEXT,
    "attachment_source" "AwbAttachmentSource" NOT NULL,
    "attached_by" TEXT,
    "reason" TEXT,
    "attached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMP(3),

    CONSTRAINT "sub_order_awb_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "low_stock_alerts" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL DEFAULT 'SELLER_MAPPING',
    "seller_product_mapping_id" TEXT,
    "franchise_stock_id" TEXT,
    "seller_id" TEXT,
    "franchise_id" TEXT,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "current_stock" INTEGER NOT NULL,
    "available_stock" INTEGER NOT NULL DEFAULT 0,
    "reserved_stock" INTEGER NOT NULL DEFAULT 0,
    "threshold" INTEGER NOT NULL,
    "status" "LowStockAlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "resolved_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "dismissed_by" TEXT,
    "dismiss_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "low_stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_tax_snapshots" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "line_type" "TaxLineType" NOT NULL DEFAULT 'PRODUCT',
    "supplier_type" "SupplierType",
    "seller_id" TEXT,
    "product_id" TEXT,
    "variant_id" TEXT,
    "description" TEXT,
    "uqc_code" TEXT,
    "quantity" DECIMAL(12,3),
    "gross_line_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "supply_taxability" "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE',
    "price_includes_tax" BOOLEAN NOT NULL DEFAULT true,
    "cess_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "cess_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "line_total_after_discount_and_tax_in_paise" BIGINT NOT NULL DEFAULT 0,
    "hsn_code" TEXT,
    "seller_gstin" TEXT,
    "buyer_gstin" TEXT,
    "seller_state_code" TEXT,
    "place_of_supply" TEXT,
    "tax_split_type" "TaxSplitType",
    "reverse_charge_applicable" BOOLEAN NOT NULL DEFAULT false,
    "currency_code" TEXT NOT NULL DEFAULT 'INR',
    "tax_data_status" "TaxDataStatus" NOT NULL DEFAULT 'COMPLETE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_tax_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_order_tax_summaries" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "seller_id" TEXT,
    "supplier_type" "SupplierType",
    "seller_gstin" TEXT,
    "seller_state_code" TEXT,
    "buyer_gstin" TEXT,
    "place_of_supply_state_code" TEXT,
    "tax_split_type" "TaxSplitType",
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cess_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "round_off_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "invoice_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'INR',
    "tax_data_status" "TaxDataStatus" NOT NULL DEFAULT 'COMPLETE',
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_order_tax_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tax_summaries" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cess_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "round_off_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "invoice_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'INR',
    "tax_data_status" "TaxDataStatus" NOT NULL DEFAULT 'COMPLETE',
    "sub_order_count" INTEGER NOT NULL DEFAULT 0,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_tax_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "state" "OutboxEventState" NOT NULL DEFAULT 'PENDING',
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupe_key" TEXT,
    "debounce_until" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "correlation_id" TEXT,
    "causation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_dead_letters" (
    "id" TEXT NOT NULL,
    "outbox_event_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "failure_reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "dead_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deduplication" (
    "event_id" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deduplication_pkey" PRIMARY KEY ("event_id","handler")
);

-- CreateTable
CREATE TABLE "own_brand_warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_brand_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_brand_stocks" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "last_landed_cost" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_brand_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_brand_procurement_orders" (
    "id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "status" "OwnBrandProcurementStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_date" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "supplier_reference" TEXT,
    "notes" TEXT,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_brand_procurement_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_brand_procurement_order_items" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "own_brand_sku" TEXT,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "own_brand_procurement_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_brand_procurement_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "own_brand_procurement_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_brand_stock_movements" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "kind" "OwnBrandStockMovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "reason" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "own_brand_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_brand_procurement_receipts" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "po_item_id" TEXT NOT NULL,
    "quantity_received" INTEGER NOT NULL,
    "notes" TEXT,
    "received_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "own_brand_procurement_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "method" "PaymentLifecycleMethod" NOT NULL,
    "status" "PaymentLifecycleStatus" NOT NULL DEFAULT 'CREATED',
    "amount_in_paise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "idempotency_key" TEXT,
    "expires_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3),
    "terminal_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

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
    "amount_in_paise" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "response_summary" TEXT,
    "failure_reason" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_mismatch_alerts" (
    "id" TEXT NOT NULL,
    "kind" "PaymentMismatchKind" NOT NULL,
    "status" "PaymentMismatchStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 50,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "source_type" "PaymentMismatchSource" NOT NULL DEFAULT 'SYSTEM',
    "source_context" JSONB,
    "master_order_id" TEXT,
    "order_number" TEXT,
    "provider_payment_id" TEXT,
    "expected_in_paise" BIGINT,
    "actual_in_paise" BIGINT,
    "description" TEXT NOT NULL,
    "resolution_notes" TEXT,
    "resolved_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_mismatch_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargebacks" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "provider_dispute_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "master_order_id" TEXT,
    "order_number" TEXT,
    "customer_id" TEXT,
    "reason_code" TEXT,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'OPEN',
    "amount_in_paise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "due_date" TIMESTAMP(3),
    "evidence_status" "ChargebackEvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "financial_impact" "ChargebackFinancialImpact" NOT NULL DEFAULT 'HELD',
    "evidence_submitted_at" TIMESTAMP(3),
    "evidence_submitted_by" TEXT,
    "evidence_notes" TEXT,
    "raw_payload" JSONB,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chargebacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_event_id" TEXT,
    "provider_payment_id" TEXT,
    "master_order_id" TEXT,
    "payload_sha256" TEXT NOT NULL,
    "signature" TEXT,
    "processing_status" "PaymentWebhookProcessingStatus" NOT NULL DEFAULT 'PROCESSING',
    "error_message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_offices" (
    "id" TEXT NOT NULL,
    "circle_name" TEXT NOT NULL,
    "region_name" TEXT NOT NULL,
    "division_name" TEXT NOT NULL,
    "office_name" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "office_type" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "state_code" TEXT,
    "latitude" DECIMAL(12,7),
    "longitude" DECIMAL(12,7),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "verified_buyer" BOOLEAN NOT NULL DEFAULT false,
    "moderated_at" TIMESTAMP(3),
    "moderated_by_id" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "run_number" TEXT,
    "kind" "ReconciliationKind" NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'QUEUED',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_expected" INTEGER NOT NULL DEFAULT 0,
    "total_matched" INTEGER NOT NULL DEFAULT 0,
    "total_discrepancies" INTEGER NOT NULL DEFAULT 0,
    "expected_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "matched_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "started_by_admin_id" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_discrepancies" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" "DiscrepancyKind" NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 50,
    "master_order_id" TEXT,
    "order_number" TEXT,
    "external_ref" TEXT,
    "expected_in_paise" BIGINT,
    "actual_in_paise" BIGINT,
    "difference_in_paise" BIGINT,
    "description" TEXT NOT NULL,
    "suggested_action" TEXT,
    "investigating_by_admin_id" TEXT,
    "investigating_at" TIMESTAMP(3),
    "assigned_to_admin_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "resolution_notes" TEXT,
    "resolved_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_discrepancy_status_history" (
    "id" TEXT NOT NULL,
    "discrepancy_id" TEXT NOT NULL,
    "from_status" "DiscrepancyStatus",
    "to_status" "DiscrepancyStatus" NOT NULL,
    "actor_admin_id" TEXT,
    "actor_role" TEXT,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_discrepancy_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_instructions" (
    "id" TEXT NOT NULL,
    "source_type" "RefundSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT,
    "amount_in_paise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "refund_method" "RefundMethod" NOT NULL,
    "status" "RefundInstructionStatus" NOT NULL DEFAULT 'APPROVED',
    "idempotency_key" TEXT,
    "gateway_refund_id" TEXT,
    "wallet_transaction_id" TEXT,
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "processed_at" TIMESTAMP(3),
    "first_approved_by" TEXT,
    "first_approved_at" TIMESTAMP(3),
    "approval_due_by" TIMESTAMP(3),
    "clarification_note" TEXT,
    "clarification_by" TEXT,
    "clarification_at" TIMESTAMP(3),
    "linked_dispute_id" TEXT,
    "customer_visible_reason" TEXT,
    "routed_back_at" TIMESTAMP(3),
    "routed_back_by" TEXT,
    "is_goodwill" BOOLEAN NOT NULL DEFAULT false,
    "customer_remedy" TEXT,
    "customer_visible_message" TEXT,
    "settled_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "poll_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_poll_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_instruction_status_history" (
    "id" TEXT NOT NULL,
    "instruction_id" TEXT NOT NULL,
    "from_status" "RefundInstructionStatus",
    "to_status" "RefundInstructionStatus" NOT NULL,
    "actor_id" TEXT,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_instruction_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_refund_webhook_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "refund_id" TEXT,
    "payment_id" TEXT,
    "raw_payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "processed_outcome" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_refund_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_sagas" (
    "id" TEXT NOT NULL,
    "refund_type" "RefundSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "instruction_id" TEXT,
    "idempotency_key" TEXT,
    "wallet_transaction_id" TEXT,
    "gateway_refund_id" TEXT,
    "amount_in_paise" BIGINT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "RefundSagaStatus" NOT NULL DEFAULT 'STARTED',
    "steps" JSONB NOT NULL,
    "compensations" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "refund_sagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '*',
    "retain_days" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL DEFAULT 'DELETE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_executions" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" "RetentionAction" NOT NULL,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_reason" TEXT,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_eligibility_audits" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "result_eligible" BOOLEAN NOT NULL,
    "result_reason" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "eligible_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_eligibility_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "version" INTEGER NOT NULL DEFAULT 0,
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
    "received_by_actor_type" TEXT,
    "parcel_condition" TEXT,
    "received_bypassed_in_transit" BOOLEAN NOT NULL DEFAULT false,
    "received_bypass_reason" TEXT,
    "qc_status" TEXT,
    "qc_claimed_by" TEXT,
    "qc_claimed_at" TIMESTAMP(3),
    "qc_lock_expires_at" TIMESTAMP(3),
    "qc_completed_at" TIMESTAMP(3),
    "qc_decision" "QcOutcome",
    "qc_notes" TEXT,
    "liability_party" "LiabilityParty",
    "customer_remedy" "CustomerRemedy",
    "qc_rationale" TEXT,
    "qc_internal_notes" TEXT,
    "qc_courier_name" TEXT,
    "qc_awb_number" TEXT,
    "seller_response_status" "SellerResponseStatus",
    "seller_notified_at" TIMESTAMP(3),
    "seller_response_due_at" TIMESTAMP(3),
    "seller_responded_at" TIMESTAMP(3),
    "seller_response_notes" TEXT,
    "seller_contest_reason_category" TEXT,
    "seller_response_extended_by" TEXT,
    "seller_response_extended_at" TIMESTAMP(3),
    "seller_response_extension_hours" INTEGER,
    "risk_score" INTEGER,
    "risk_flags" JSONB,
    "risk_scored_at" TIMESTAMP(3),
    "replacement_status" "ReplacementRequestStatus",
    "replacement_order_id" TEXT,
    "exchange_order_id" TEXT,
    "exchange_target_variant_id" TEXT,
    "exchange_price_diff_paise" BIGINT,
    "exchange_razorpay_order_id" TEXT,
    "exchange_payment_completed_at" TIMESTAMP(3),
    "refund_method" "ReturnRefundMethod",
    "refund_amount" DECIMAL(10,2),
    "refund_amount_in_paise" BIGINT,
    "refund_processed_at" TIMESTAMP(3),
    "refund_reference" TEXT,
    "refund_attempts" INTEGER NOT NULL DEFAULT 0,
    "refund_last_attempt_at" TIMESTAMP(3),
    "refund_failure_reason" TEXT,
    "refund_failure_history" JSONB,
    "refund_failure_message_customer" TEXT,
    "refund_initiated_by" TEXT,
    "refund_initiated_at" TIMESTAMP(3),
    "customer_notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "closed_by_actor_type" TEXT,
    "close_reason" VARCHAR(500),
    "refund_failed_by" TEXT,
    "refund_failed_by_actor_type" TEXT,
    "refund_failed_at" TIMESTAMP(3),
    "refund_next_retry_at" TIMESTAMP(3),
    "refund_max_retries" INTEGER,
    "credit_note_eligibility_status" "CreditNoteEligibilityStatus",
    "credit_note_eligibility_checked_at" TIMESTAMP(3),
    "credit_note_time_bar_reason" TEXT,
    "finance_reviewed_by" TEXT,
    "finance_reviewed_at" TIMESTAMP(3),
    "return_policy_snapshot_json" JSONB,
    "seller_id_snapshot" TEXT,
    "franchise_id_snapshot" TEXT,
    "node_type_snapshot" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_by_role" TEXT,
    "cancellation_reason" TEXT,
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
    "seller_item_response" "SellerResponseStatus",
    "seller_item_responded_at" TIMESTAMP(3),
    "seller_item_response_note" VARCHAR(2000),
    "received_qty" INTEGER,
    "received_condition" TEXT,
    "qc_outcome" "QcOutcome",
    "qc_quantity_approved" INTEGER,
    "qc_notes" TEXT,
    "refund_amount" DECIMAL(10,2),
    "refund_amount_in_paise" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_evidence" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "return_item_id" TEXT,
    "evidence_type" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "content_hash" TEXT,
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
CREATE TABLE "refund_transactions" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gateway_refund_id" TEXT,
    "status" "RefundTransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "failure_reason" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_sequences" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "return_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_tax_reversal_lines" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "return_item_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "gross_returned_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_reversal_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_credit_note_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "hsn_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_tax_reversal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_scores" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" "RiskTier" NOT NULL,
    "signals" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_product_mappings" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "seller_internal_sku" TEXT,
    "settlement_price" DECIMAL(10,2),
    "procurement_cost" DECIMAL(10,2),
    "pickup_address" TEXT,
    "pickup_pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "dispatch_sla" INTEGER NOT NULL DEFAULT 2,
    "approval_status" "MappingApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "operational_priority" INTEGER NOT NULL DEFAULT 0,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "stopped_by" TEXT,
    "stopped_at" TIMESTAMP(3),
    "suspended_by" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "reactivated_by" TEXT,
    "reactivated_at" TIMESTAMP(3),
    "reactivation_reason" TEXT,
    "migrated_from_mapping_id" TEXT,
    "migrated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL DEFAULT 'SELLER_MAPPING',
    "resource_id" TEXT NOT NULL DEFAULT '',
    "mapping_id" TEXT,
    "kind" "StockMovementKind" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "before_stock_qty" INTEGER NOT NULL,
    "after_stock_qty" INTEGER NOT NULL,
    "before_reserved_qty" INTEGER,
    "after_reserved_qty" INTEGER,
    "reason" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_reversals" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "status" "SellerReversalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "reversal_value_in_paise" BIGINT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_admin_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "seller_debit_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_reversal_items" (
    "id" TEXT NOT NULL,
    "reversal_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_in_paise" BIGINT NOT NULL,

    CONSTRAINT "seller_reversal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "seller_type" "SellerType" NOT NULL DEFAULT 'D2C',
    "seller_name" TEXT NOT NULL,
    "seller_shop_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "seller_contact_country_code" TEXT,
    "seller_contact_number" TEXT,
    "store_address" TEXT,
    "locality" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "seller_zip_code" TEXT,
    "short_store_description" TEXT,
    "detailed_store_description" TEXT,
    "seller_policy" TEXT,
    "seller_profile_image_url" TEXT,
    "seller_profile_image_public_id" TEXT,
    "seller_shop_logo_url" TEXT,
    "seller_shop_logo_public_id" TEXT,
    "profile_completion_percentage" INTEGER NOT NULL DEFAULT 0,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(3),
    "verification_status" "SellerVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "is_profile_completed" BOOLEAN NOT NULL DEFAULT false,
    "last_profile_updated_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "gstin" TEXT,
    "legal_business_name" TEXT,
    "entity_type" "BusinessEntityType",
    "registered_business_address_json" JSONB,
    "gst_state_code" TEXT,
    "gst_registration_type" "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
    "is_gst_verified" BOOLEAN NOT NULL DEFAULT false,
    "gst_verified_at" TIMESTAMP(3),
    "gst_verified_by" TEXT,
    "gst_verification_notes" TEXT,
    "kyc_approval_notes" TEXT,
    "kyc_rejection_reason" TEXT,
    "kyc_reviewed_at" TIMESTAMP(3),
    "kyc_reviewed_by" TEXT,
    "kyc_confirmed_accurate_at" TIMESTAMP(3),
    "is_gstin_manually_verified" BOOLEAN NOT NULL DEFAULT false,
    "pan_number" TEXT,
    "pan_last_4" TEXT,
    "pan_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_194o_exempt" BOOLEAN NOT NULL DEFAULT false,
    "exempt_194o_reason" TEXT,
    "exempt_194o_attested_by" TEXT,
    "exempt_194o_attested_at" TIMESTAMP(3),
    "exempt_194o_effective_from" TIMESTAMP(3),
    "exempt_194o_effective_to" TIMESTAMP(3),
    "exempt_194o_revoked_by" TEXT,
    "exempt_194o_revoked_at" TIMESTAMP(3),
    "exempt_194o_revoke_reason" TEXT,
    "self_delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
    "self_delivery_pincodes" JSONB,
    "accept_sla_hours" INTEGER,
    "fulfillment_hold" BOOLEAN NOT NULL DEFAULT false,
    "fulfillment_hold_reason" TEXT,
    "fulfillment_hold_at" TIMESTAMP(3),
    "fulfillment_hold_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_tds_exemption_history" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "is_exempt" BOOLEAN NOT NULL,
    "reason" TEXT,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "changed_by" TEXT,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_tds_exemption_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_sessions" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "device_label" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_password_reset_otps" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified_at" TIMESTAMP(3),
    "reset_token" TEXT,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_bank_details" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "account_holder_name" VARCHAR(150) NOT NULL,
    "account_number_enc" TEXT NOT NULL,
    "account_number_last_4" VARCHAR(4) NOT NULL,
    "ifsc_code" VARCHAR(11) NOT NULL,
    "bank_name" VARCHAR(150),
    "upi_vpa" VARCHAR(100),
    "preferred_payout_method" VARCHAR(8),
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_bank_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_partner_registrations" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "partner" VARCHAR(32) NOT NULL,
    "warehouse_name" VARCHAR(128),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "registered_at" TIMESTAMP(3),
    "registered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_partner_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_service_areas" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "cod_eligible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "mapping_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "customer_id" TEXT,
    "session_id" TEXT,
    "cart_id" TEXT,
    "order_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "expired_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_logs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "customer_pincode" TEXT NOT NULL,
    "allocated_node_type" TEXT,
    "allocated_seller_id" TEXT,
    "allocated_franchise_id" TEXT,
    "allocated_mapping_id" TEXT,
    "allocated_pincode_mapping_id" TEXT,
    "allocation_reason" TEXT,
    "event_source" "AllocationEventSource" NOT NULL DEFAULT 'LIVE',
    "outcome" "AllocationOutcome",
    "reason_code" "AllocationReasonCode",
    "distance_km" DECIMAL(10,2),
    "score" DECIMAL(10,4),
    "is_reallocated" BOOLEAN NOT NULL DEFAULT false,
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_candidates" (
    "id" TEXT NOT NULL,
    "allocation_log_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "node_type" TEXT NOT NULL,
    "seller_id" TEXT,
    "franchise_id" TEXT,
    "mapping_id" TEXT NOT NULL,
    "distance_km" DECIMAL(10,2),
    "available_stock" INTEGER NOT NULL,
    "dispatch_sla" INTEGER NOT NULL,
    "score" DECIMAL(10,4) NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclude_reason" TEXT,

    CONSTRAINT "allocation_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_cycles" (
    "id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "payout_due_by" TIMESTAMP(3),
    "status" "SettlementCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_margin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_margin_in_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_admin_id" TEXT,
    "approved_by_admin_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_notes" TEXT,

    CONSTRAINT "settlement_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_settlements" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "total_platform_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_settlement_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_platform_margin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "approved_settlement_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_platform_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_settlement_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "approved_settlement_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_platform_margin_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tcs_ledger_id" TEXT,
    "tcs_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tcs_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
    "tcs_filing_period" TEXT,
    "tds_ledger_id" TEXT,
    "tds_deducted_in_paise" BIGINT NOT NULL DEFAULT 0,
    "tds_rate_bps_snapshot" INTEGER NOT NULL DEFAULT 100,
    "tds_filing_period" TEXT,
    "tds_skip_reason" TEXT,
    "commission_gst_rate_bps" INTEGER NOT NULL DEFAULT 1800,
    "commission_gst_split_type" TEXT,
    "cgst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_commission_gst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "commission_gst_marketplace_state_code" TEXT,
    "commission_gst_seller_state_code" TEXT,
    "commission_invoice_number" TEXT,
    "commission_invoice_date" TIMESTAMP(3),
    "commission_invoice_filing_period" TEXT,
    "commission_place_of_supply_state_code" TEXT,
    "commission_invoice_supplier_gstin" TEXT,
    "commission_invoice_recipient_gstin" TEXT,
    "commission_recipient_is_b2c" BOOLEAN NOT NULL DEFAULT false,
    "commission_invoice_sac_code" TEXT,
    "commission_invoice_irn" TEXT,
    "commission_invoice_irn_ack_no" TEXT,
    "commission_invoice_irn_ack_at" TIMESTAMP(3),
    "commission_invoice_credit_note_for_id" TEXT,
    "status" "SellerSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "utr_reference" TEXT,
    "paid_by_admin_id" TEXT,
    "payment_method" TEXT,
    "payment_proof_url" TEXT,
    "payment_failure_reason" TEXT,
    "payout_batch_id" TEXT,
    "payout_due_by" TIMESTAMP(3),
    "hold_reason" TEXT,
    "frozen_at" TIMESTAMP(3),
    "frozen_by_admin_id" TEXT,
    "paid_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "dynamic_charge_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "charge_rules_applied" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_adjustments" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "adjustment_type" "SettlementAdjustmentType" NOT NULL DEFAULT 'OTHER',
    "status" "SettlementAdjustmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "reference_document_url" TEXT,
    "created_by_admin_id" TEXT,
    "voided_by_admin_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_charge_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "base_type" TEXT NOT NULL,
    "base_rule_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_charge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_charge_lines" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "rule_name" TEXT NOT NULL,
    "base_type" TEXT NOT NULL,
    "base_rule_id" TEXT,
    "base_amount_in_paise" BIGINT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "amount_in_paise" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_charge_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_options" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "delivery_details" TEXT,
    "rate_type" "ShippingRateType" NOT NULL DEFAULT 'FLAT',
    "price_in_paise" BIGINT NOT NULL DEFAULT 0,
    "transit_min_days" INTEGER,
    "transit_max_days" INTEGER,
    "free_shipping_min_cart_paise" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active_from" TIMESTAMP(3),
    "active_until" TIMESTAMP(3),
    "seller_id" TEXT,
    "price_is_tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "tax_hsn_code" TEXT,
    "tax_gst_rate_bps" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "active_from" TIMESTAMP(3),
    "active_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_options" (
    "zone_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,

    CONSTRAINT "shipping_zone_options_pkey" PRIMARY KEY ("zone_id","option_id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "zone_id" TEXT,
    "min_weight_grams" INTEGER NOT NULL DEFAULT 0,
    "max_weight_grams" INTEGER,
    "min_cart_paise" BIGINT NOT NULL DEFAULT 0,
    "max_cart_paise" BIGINT,
    "base_paise" BIGINT NOT NULL DEFAULT 0,
    "per_kg_paise" BIGINT NOT NULL DEFAULT 0,
    "per_kg_step" INTEGER NOT NULL DEFAULT 500,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_surcharges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ShippingSurchargeKind" NOT NULL,
    "zone_id" TEXT,
    "option_id" TEXT,
    "value_type" "ShippingSurchargeValueType" NOT NULL,
    "value" BIGINT NOT NULL,
    "min_cart_paise" BIGINT,
    "max_cap_paise" BIGINT,
    "stacking_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_quote_audits" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT,
    "master_order_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "net_cart_value_in_paise" BIGINT NOT NULL,
    "total_weight_grams" INTEGER,
    "destination_pincode" TEXT,
    "origin_pincode" TEXT,
    "buyer_state_code" TEXT,
    "payment_method" TEXT,
    "matched_zone_id" TEXT,
    "matched_rate_id" TEXT,
    "selected_option_id" TEXT,
    "base_fee_in_paise" BIGINT NOT NULL,
    "surcharges_applied_json" JSONB,
    "fee_in_paise" BIGINT NOT NULL,
    "taxable_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_in_paise" BIGINT NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_quote_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "awb" TEXT,
    "status" TEXT,
    "raw_payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "process_outcome" TEXT,
    "error_message" TEXT,
    "sub_order_id" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_tracking_events" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "internal_status" "shipment_internal_status_enum" NOT NULL,
    "external_status" TEXT NOT NULL,
    "external_status_code" TEXT,
    "scan_location" TEXT,
    "remarks" TEXT,
    "scan_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ndr_attempts" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "reason_code" TEXT,
    "reason" TEXT,
    "scan_location" TEXT,
    "carrier_event_id" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ndr_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rto_events" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "status" "shipment_internal_status_enum" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "scan_location" TEXT,
    "carrier_event_id" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rto_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rto_credit_note_pending" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_in_paise" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issued_at" TIMESTAMP(3),
    "issued_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rto_credit_note_pending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resource_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deadline_minutes" INTEGER NOT NULL,
    "warning_minutes_before_deadline" INTEGER,
    "escalate_after_minutes" INTEGER,
    "escalate_action" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_breaches" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entered_status_at" TIMESTAMP(3) NOT NULL,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "breached_at" TIMESTAMP(3) NOT NULL,
    "escalated_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "overdue_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_menus" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_menu_items" (
    "id" TEXT NOT NULL,
    "menu_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "display_label" TEXT,
    "link_type" "MenuLinkType" NOT NULL DEFAULT 'NONE',
    "link_ref" TEXT,
    "filter_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "open_in_new_tab" BOOLEAN NOT NULL DEFAULT false,
    "rel_nofollow" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_audit_logs" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prev_state" JSONB,
    "new_state" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopedTo" "TicketActorType",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "priority_updated_by" TEXT,
    "priority_updated_at" TIMESTAMP(3),
    "creator_type" "TicketActorType" NOT NULL,
    "creator_id" TEXT NOT NULL,
    "creator_name" TEXT NOT NULL,
    "creator_email" TEXT NOT NULL,
    "assigned_admin_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "assigned_by_admin_id" TEXT,
    "category_id" TEXT,
    "related_order_id" TEXT,
    "related_return_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_admin_id" TEXT,
    "resolution_summary" TEXT,
    "sla_target_at" TIMESTAMP(3),
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "escalated_at" TIMESTAMP(3),
    "promoted_to_dispute_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "sender_type" "TicketActorType" NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "mirrored_from_dispute_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_document_download_audits" (
    "id" TEXT NOT NULL,
    "tax_document_id" TEXT NOT NULL,
    "actor_type" "TaxDocumentActorType" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT,
    "outcome" "TaxDocumentDownloadOutcome" NOT NULL,
    "deny_reason" TEXT,
    "issued_url" TEXT,
    "url_expires_at" TIMESTAMP(3),
    "ttl_seconds" INTEGER NOT NULL DEFAULT 300,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_document_download_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_documents" (
    "id" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "financial_year" TEXT NOT NULL,
    "master_order_id" TEXT,
    "sub_order_id" TEXT,
    "seller_id" TEXT,
    "franchise_id" TEXT,
    "customer_id" TEXT,
    "pos_sale_id" TEXT,
    "supplier_type" "SupplierType" NOT NULL,
    "invoice_type" "InvoiceType",
    "gst_mode_snapshot" "GstMode",
    "supplier_gstin" TEXT,
    "seller_registration_type" "GstRegistrationType",
    "seller_legal_name" TEXT,
    "seller_address_json" JSONB,
    "seller_state_code" TEXT,
    "platform_gst_profile_id" TEXT,
    "customer_tax_profile_id" TEXT,
    "buyer_gstin" TEXT,
    "buyer_legal_name" TEXT,
    "billing_address_json" JSONB,
    "shipping_address_json" JSONB,
    "place_of_supply_state_code" TEXT,
    "reverse_charge_applicable" BOOLEAN NOT NULL DEFAULT false,
    "reverse_charge_reason" TEXT,
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cess_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "round_off_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "document_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "amount_in_words" TEXT,
    "currency_code" TEXT NOT NULL DEFAULT 'INR',
    "payment_mode" TEXT,
    "original_document_id" TEXT,
    "original_document_number" TEXT,
    "reason" TEXT,
    "return_id" TEXT,
    "partial_coverage_line_count" INTEGER NOT NULL DEFAULT 0,
    "customer_notified_at" TIMESTAMP(3),
    "status" "TaxDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "pdf_url" TEXT,
    "pdf_storage_path" TEXT,
    "pdf_sha_256" TEXT,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMP(3),
    "pdf_retry_count" INTEGER NOT NULL DEFAULT 0,
    "pdf_last_attempted_at" TIMESTAMP(3),
    "pdf_failure_reason" TEXT,
    "pdf_provider" TEXT,
    "irn" TEXT,
    "ack_no" TEXT,
    "ack_date" TIMESTAMP(3),
    "signed_document_json" JSONB,
    "qr_code_url" TEXT,
    "einvoice_status" "EInvoiceStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "einvoice_retry_count" INTEGER NOT NULL DEFAULT 0,
    "einvoice_last_attempted_at" TIMESTAMP(3),
    "einvoice_failure_reason" TEXT,
    "einvoice_error_code" TEXT,
    "einvoice_provider" TEXT,
    "einvoice_generated_by" TEXT,
    "einvoice_generated_at" TIMESTAMP(3),
    "einvoice_cancellation_code" INTEGER,
    "einvoice_cancellation_reason" TEXT,
    "einvoice_cancelled_by" TEXT,
    "signed_document_json_retention_until" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "einvoice_audit_logs" (
    "id" TEXT NOT NULL,
    "tax_document_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "EInvoiceStatus",
    "to_status" "EInvoiceStatus",
    "actor_id" TEXT,
    "actor_role" TEXT,
    "reason" TEXT,
    "provider_name" TEXT,
    "provider_latency_ms" INTEGER,
    "payload_before" JSONB,
    "payload_after" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "einvoice_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_document_lines" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "source_snapshot_id" TEXT,
    "line_number" INTEGER NOT NULL,
    "line_type" "TaxLineType" NOT NULL,
    "product_id" TEXT,
    "variant_id" TEXT,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "hsn_or_sac_code" TEXT,
    "uqc_code" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price_in_paise" BIGINT NOT NULL,
    "gross_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "taxable_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "supply_taxability" "SupplyTaxability",
    "cgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "sgst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "igst_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "total_tax_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "cess_amount_in_paise" BIGINT NOT NULL DEFAULT 0,
    "line_total_in_paise" BIGINT NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "sequence_key" TEXT NOT NULL,
    "supplier_gstin" TEXT,
    "financial_year" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "skipped_numbers" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_readiness_snapshots" (
    "id" TEXT NOT NULL,
    "current_mode" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL,
    "total_blockers" INTEGER NOT NULL,
    "critical_blockers" INTEGER NOT NULL DEFAULT 0,
    "blockers_json" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_readiness_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "india_states" (
    "id" TEXT NOT NULL,
    "gst_state_code" TEXT NOT NULL,
    "state_name" TEXT NOT NULL,
    "iso_code" TEXT,
    "is_union_territory" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "india_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uqc_master" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deactivation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uqc_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uqc_master_history" (
    "id" TEXT NOT NULL,
    "uqc_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uqc_master_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hsn_master" (
    "id" TEXT NOT NULL,
    "hsn_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "default_gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "supply_taxability" "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE',
    "default_uqc_code" TEXT,
    "category_hint" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deactivation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hsn_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hsn_master_history" (
    "id" TEXT NOT NULL,
    "hsn_master_id" TEXT NOT NULL,
    "hsn_code" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hsn_master_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_gstins" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "address_json" JSONB NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "registration_type" "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verification_notes" TEXT,
    "legal_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "gst_legal_name" TEXT,
    "gstn_portal_status" "GstnPortalStatus",
    "gstn_raw_response_json" JSONB,
    "verification_failure_reason" TEXT,
    "last_verified_provider" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "aggregate_turnover_in_paise" BIGINT NOT NULL DEFAULT 0,
    "einvoice_opted_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_gstins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tax_profiles" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "billing_address_json" JSONB NOT NULL,
    "state_code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verification_notes" TEXT,
    "legal_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "gst_legal_name" TEXT,
    "gstn_portal_status" "GstnPortalStatus",
    "gstn_raw_response_json" JSONB,
    "verification_failure_reason" TEXT,
    "last_verified_provider" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_selected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tax_profile_history" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tax_profile_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gstin_verification_events" (
    "id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "actor_id" TEXT,
    "found" BOOLEAN NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "portal_legal_name" TEXT,
    "legal_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "raw_response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gstin_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_gst_profiles" (
    "id" TEXT NOT NULL,
    "legal_business_name" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "registered_address_json" JSONB NOT NULL,
    "gst_state_code" TEXT NOT NULL,
    "registration_type" "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
    "pan_number" TEXT,
    "pan_last_4" TEXT,
    "pan_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deactivation_reason" TEXT,
    "set_default_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_gst_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_gst_profile_history" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_gst_profile_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_mode_history" (
    "id" TEXT NOT NULL,
    "from_mode" "GstMode",
    "to_mode" "GstMode" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "blocker_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gst_mode_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_refund_sagas" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_in_paise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WalletRefundSagaStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_refund_sagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance_in_paise" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "version" INTEGER NOT NULL DEFAULT 0,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_reason" TEXT,
    "blocked_at" TIMESTAMP(3),
    "blocked_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "amount_in_paise" BIGINT NOT NULL,
    "balance_after_in_paise" BIGINT NOT NULL,
    "balance_before_in_paise" BIGINT NOT NULL DEFAULT 0,
    "direction" "WalletDirection",
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reference_number" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "internal_notes" TEXT,
    "created_by_admin_id" TEXT,
    "credit_type" "WalletCreditType",
    "expires_at" TIMESTAMP(3),
    "lapsed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_earn_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "eligible_amount_in_paise" BIGINT NOT NULL,
    "rebate_in_paise" BIGINT NOT NULL DEFAULT 0,
    "clawed_back_in_paise" BIGINT NOT NULL DEFAULT 0,
    "rate_bps" INTEGER NOT NULL DEFAULT 0,
    "status" "LoyaltyEarnStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "wallet_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "loyalty_earn_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_adjustments" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "wallet_id" TEXT,
    "sub_order_id" TEXT,
    "return_id" TEXT,
    "source_tax_document_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "kind" "WalletAdjustmentKind" NOT NULL,
    "status" "WalletAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "amount_in_paise" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "would_have_been_taxable_in_paise" BIGINT,
    "would_have_been_cgst_in_paise" BIGINT,
    "would_have_been_sgst_in_paise" BIGINT,
    "would_have_been_igst_in_paise" BIGINT,
    "would_have_been_total_tax_in_paise" BIGINT,
    "reason" TEXT NOT NULL,
    "requested_by_admin_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_approved_by_admin_id" TEXT,
    "first_approved_at" TIMESTAMP(3),
    "approved_by_admin_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_admin_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "wallet_transaction_id" TEXT,
    "requires_dual_approval" BOOLEAN NOT NULL DEFAULT false,
    "reversed_by_admin_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,
    "reversing_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_adjustment_history" (
    "id" TEXT NOT NULL,
    "adjustment_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "WalletAdjustmentStatus",
    "to_status" "WalletAdjustmentStatus" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "amount_in_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_adjustment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "signing_secret" TEXT NOT NULL,
    "event_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" "WebhookEnvironment" NOT NULL DEFAULT 'LIVE',
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "seller_id" TEXT,
    "affiliate_id" TEXT,
    "retry_schedule" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "last_status_code" INTEGER,
    "last_response" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "note" VARCHAR(280),
    "unit_price_in_paise_at_add" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_logs_actor_type_actor_id_idx" ON "access_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "access_logs_actor_type_actor_role_created_at_idx" ON "access_logs"("actor_type", "actor_role", "created_at");

-- CreateIndex
CREATE INDEX "access_logs_kind_idx" ON "access_logs"("kind");

-- CreateIndex
CREATE INDEX "access_logs_created_at_idx" ON "access_logs"("created_at");

-- CreateIndex
CREATE INDEX "access_logs_request_id_idx" ON "access_logs"("request_id");

-- CreateIndex
CREATE INDEX "access_logs_kind_created_at_ip_address_idx" ON "access_logs"("kind", "created_at", "ip_address");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_role_idx" ON "admins"("role");

-- CreateIndex
CREATE INDEX "admins_status_idx" ON "admins"("status");

-- CreateIndex
CREATE INDEX "admins_mfa_pending_expires_at_idx" ON "admins"("mfa_pending_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_password_reset_otps_reset_token_key" ON "admin_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "admin_password_reset_otps_admin_id_idx" ON "admin_password_reset_otps"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_refresh_token_hash_idx" ON "admin_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_previous_refresh_token_hash_idx" ON "admin_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_revoked_at_idx" ON "admin_sessions"("admin_id", "revoked_at");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_expires_at_idx" ON "admin_sessions"("admin_id", "expires_at");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_admin_id_idx" ON "admin_action_audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_seller_id_idx" ON "admin_action_audit_logs"("seller_id");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_action_type_idx" ON "admin_action_audit_logs"("action_type");

-- CreateIndex
CREATE INDEX "admin_action_audit_logs_created_at_idx" ON "admin_action_audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_impersonation_logs_token_jti_key" ON "admin_impersonation_logs"("token_jti");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_admin_id_idx" ON "admin_impersonation_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_seller_id_idx" ON "admin_impersonation_logs"("seller_id");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_is_active_idx" ON "admin_impersonation_logs"("is_active");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_target_actor_type_target_actor_id_idx" ON "admin_impersonation_logs"("target_actor_type", "target_actor_id");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_started_at_idx" ON "admin_impersonation_logs"("started_at");

-- CreateIndex
CREATE INDEX "admin_impersonation_logs_ended_at_idx" ON "admin_impersonation_logs"("ended_at");

-- CreateIndex
CREATE INDEX "admin_seller_messages_seller_id_idx" ON "admin_seller_messages"("seller_id");

-- CreateIndex
CREATE INDEX "admin_seller_messages_sent_by_admin_id_idx" ON "admin_seller_messages"("sent_by_admin_id");

-- CreateIndex
CREATE INDEX "admin_seller_messages_created_at_idx" ON "admin_seller_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_custom_roles_name_key" ON "admin_custom_roles"("name");

-- CreateIndex
CREATE INDEX "admin_custom_roles_is_active_idx" ON "admin_custom_roles"("is_active");

-- CreateIndex
CREATE INDEX "admin_custom_role_permissions_permission_key_idx" ON "admin_custom_role_permissions"("permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_custom_role_permissions_role_id_permission_key_key" ON "admin_custom_role_permissions"("role_id", "permission_key");

-- CreateIndex
CREATE INDEX "admin_role_assignments_admin_id_idx" ON "admin_role_assignments"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_role_assignments_admin_id_role_id_key" ON "admin_role_assignments"("admin_id", "role_id");

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
CREATE INDEX "affiliates_kyc_status_idx" ON "affiliates"("kyc_status");

-- CreateIndex
CREATE INDEX "affiliate_status_history_affiliate_id_created_at_idx" ON "affiliate_status_history"("affiliate_id", "created_at");

-- CreateIndex
CREATE INDEX "affiliate_commission_rate_history_affiliate_id_created_at_idx" ON "affiliate_commission_rate_history"("affiliate_id", "created_at");

-- CreateIndex
CREATE INDEX "affiliate_sessions_affiliate_id_idx" ON "affiliate_sessions"("affiliate_id");

-- CreateIndex
CREATE INDEX "affiliate_sessions_refresh_token_hash_idx" ON "affiliate_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "affiliate_sessions_previous_refresh_token_hash_idx" ON "affiliate_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "affiliate_sessions_affiliate_id_revoked_at_idx" ON "affiliate_sessions"("affiliate_id", "revoked_at");

-- CreateIndex
CREATE INDEX "affiliate_sessions_affiliate_id_expires_at_idx" ON "affiliate_sessions"("affiliate_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_password_reset_otps_reset_token_key" ON "affiliate_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "affiliate_password_reset_otps_affiliate_id_idx" ON "affiliate_password_reset_otps"("affiliate_id");

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
CREATE INDEX "referral_attributions_customer_id_idx" ON "referral_attributions"("customer_id");

-- CreateIndex
CREATE INDEX "referral_attributions_code_affiliate_id_customer_id_idx" ON "referral_attributions"("code", "affiliate_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_order_id_key" ON "affiliate_commissions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_referral_attribution_id_key" ON "affiliate_commissions"("referral_attribution_id");

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
CREATE INDEX "affiliate_payout_requests_paid_at_idx" ON "affiliate_payout_requests"("paid_at");

-- CreateIndex
CREATE INDEX "affiliate_payout_request_status_history_payout_request_id_c_idx" ON "affiliate_payout_request_status_history"("payout_request_id", "created_at");

-- CreateIndex
CREATE INDEX "affiliate_tds_records_financial_year_idx" ON "affiliate_tds_records"("financial_year");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_tds_records_affiliate_id_financial_year_key" ON "affiliate_tds_records"("affiliate_id", "financial_year");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_tds_194o_ledger_payout_request_id_key" ON "affiliate_tds_194o_ledger"("payout_request_id");

-- CreateIndex
CREATE INDEX "affiliate_tds_194o_ledger_filing_period_idx" ON "affiliate_tds_194o_ledger"("filing_period");

-- CreateIndex
CREATE INDEX "affiliate_tds_194o_ledger_affiliate_id_filing_period_idx" ON "affiliate_tds_194o_ledger"("affiliate_id", "filing_period");

-- CreateIndex
CREATE INDEX "affiliate_tds_194o_ledger_status_filing_period_idx" ON "affiliate_tds_194o_ledger"("status", "filing_period");

-- CreateIndex
CREATE INDEX "ai_usage_quotas_subject_day_idx" ON "ai_usage_quotas"("subject", "day");

-- CreateIndex
CREATE INDEX "ai_usage_quotas_day_idx" ON "ai_usage_quotas"("day");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_quotas_subject_day_provider_key" ON "ai_usage_quotas"("subject", "day", "provider");

-- CreateIndex
CREATE INDEX "ai_generation_logs_subject_created_at_idx" ON "ai_generation_logs"("subject", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_logs_product_id_idx" ON "ai_generation_logs"("product_id");

-- CreateIndex
CREATE INDEX "ai_generation_logs_status_created_at_idx" ON "ai_generation_logs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_status_idx" ON "api_keys"("status");

-- CreateIndex
CREATE INDEX "api_keys_seller_id_idx" ON "api_keys"("seller_id");

-- CreateIndex
CREATE INDEX "api_keys_affiliate_id_idx" ON "api_keys"("affiliate_id");

-- CreateIndex
CREATE INDEX "api_key_usages_key_id_created_at_idx" ON "api_key_usages"("key_id", "created_at");

-- CreateIndex
CREATE INDEX "api_key_usages_status_created_at_idx" ON "api_key_usages"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_sequence_number_key" ON "audit_logs"("sequence_number");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_module_resource_idx" ON "audit_logs"("module", "resource");

-- CreateIndex
CREATE INDEX "audit_logs_resource_resource_id_idx" ON "audit_logs"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_sequence_number_idx" ON "audit_logs"("sequence_number");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "audit_chain_anchors_created_at_idx" ON "audit_chain_anchors"("created_at");

-- CreateIndex
CREATE INDEX "audit_chain_verification_runs_started_at_idx" ON "audit_chain_verification_runs"("started_at");

-- CreateIndex
CREATE INDEX "audit_chain_verification_runs_status_idx" ON "audit_chain_verification_runs"("status");

-- CreateIndex
CREATE INDEX "audit_chain_verification_issues_verification_run_id_idx" ON "audit_chain_verification_issues"("verification_run_id");

-- CreateIndex
CREATE INDEX "audit_chain_verification_issues_issue_type_idx" ON "audit_chain_verification_issues"("issue_type");

-- CreateIndex
CREATE INDEX "event_logs_event_name_idx" ON "event_logs"("event_name");

-- CreateIndex
CREATE INDEX "event_logs_aggregate_aggregate_id_idx" ON "event_logs"("aggregate", "aggregate_id");

-- CreateIndex
CREATE INDEX "event_logs_created_at_idx" ON "event_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "resource_policies_name_key" ON "resource_policies"("name");

-- CreateIndex
CREATE INDEX "resource_policies_resource_type_action_enabled_idx" ON "resource_policies"("resource_type", "action", "enabled");

-- CreateIndex
CREATE INDEX "resource_policies_principal_type_principal_key_idx" ON "resource_policies"("principal_type", "principal_key");

-- CreateIndex
CREATE INDEX "authorization_audits_admin_id_created_at_idx" ON "authorization_audits"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "authorization_audits_decision_created_at_idx" ON "authorization_audits"("decision", "created_at");

-- CreateIndex
CREATE INDEX "authorization_audits_route_label_created_at_idx" ON "authorization_audits"("route_label", "created_at");

-- CreateIndex
CREATE INDEX "authorization_audits_resource_type_action_created_at_idx" ON "authorization_audits"("resource_type", "action", "created_at");

-- CreateIndex
CREATE INDEX "authorization_audits_review_status_decision_created_at_idx" ON "authorization_audits"("review_status", "decision", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "back_in_stock_requests_product_id_notified_at_idx" ON "back_in_stock_requests"("product_id", "notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "back_in_stock_requests_product_id_email_key" ON "back_in_stock_requests"("product_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_jobs_idempotency_key_key" ON "bulk_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "bulk_jobs_actor_id_started_at_idx" ON "bulk_jobs"("actor_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "bulk_jobs_status_idx" ON "bulk_jobs"("status");

-- CreateIndex
CREATE INDEX "bulk_jobs_kind_started_at_idx" ON "bulk_jobs"("kind", "started_at" DESC);

-- CreateIndex
CREATE INDEX "case_duplicates_attempted_source_type_created_at_idx" ON "case_duplicates"("attempted_source_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "case_duplicates_duplicate_of_source_type_duplicate_of_sourc_idx" ON "case_duplicates"("duplicate_of_source_type", "duplicate_of_source_id");

-- CreateIndex
CREATE INDEX "case_duplicates_actor_type_actor_id_created_at_idx" ON "case_duplicates"("actor_type", "actor_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_level_idx" ON "categories"("level");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE INDEX "categories_parent_id_is_active_sort_order_idx" ON "categories"("parent_id", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "category_audit_logs_category_id_created_at_idx" ON "category_audit_logs"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "category_audit_logs_admin_id_created_at_idx" ON "category_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_slug_idx" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_is_active_idx" ON "brands"("is_active");

-- CreateIndex
CREATE INDEX "brands_is_active_name_idx" ON "brands"("is_active", "name");

-- CreateIndex
CREATE INDEX "brand_audit_logs_brand_id_created_at_idx" ON "brand_audit_logs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "brand_audit_logs_admin_id_created_at_idx" ON "brand_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "option_definitions_name_key" ON "option_definitions"("name");

-- CreateIndex
CREATE INDEX "option_values_option_definition_id_idx" ON "option_values"("option_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_values_option_definition_id_value_key" ON "option_values"("option_definition_id", "value");

-- CreateIndex
CREATE INDEX "category_option_templates_category_id_idx" ON "category_option_templates"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_option_templates_category_id_option_definition_id_key" ON "category_option_templates"("category_id", "option_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_product_code_key" ON "products"("product_code");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_own_brand_sku_key" ON "products"("own_brand_sku");

-- CreateIndex
CREATE INDEX "products_seller_id_idx" ON "products"("seller_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_moderation_status_idx" ON "products"("moderation_status");

-- CreateIndex
CREATE INDEX "products_slug_idx" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_is_deleted_idx" ON "products"("is_deleted");

-- CreateIndex
CREATE INDEX "products_sport_status_idx" ON "products"("sport", "status");

-- CreateIndex
CREATE INDEX "tax_attestation_logs_product_id_created_at_idx" ON "tax_attestation_logs"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "tax_attestation_logs_actor_id_created_at_idx" ON "tax_attestation_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "product_options_product_id_idx" ON "product_options"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_option_definition_id_key" ON "product_options"("product_id", "option_definition_id");

-- CreateIndex
CREATE INDEX "product_option_values_product_id_idx" ON "product_option_values"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_product_id_option_value_id_key" ON "product_option_values"("product_id", "option_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_master_sku_key" ON "product_variants"("master_sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_sku_idx" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE INDEX "product_variants_is_deleted_idx" ON "product_variants"("is_deleted");

-- CreateIndex
CREATE INDEX "product_variants_product_id_status_idx" ON "product_variants"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_sku_key" ON "product_variants"("product_id", "sku");

-- CreateIndex
CREATE INDEX "product_variant_option_values_variant_id_idx" ON "product_variant_option_values"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_option_values_variant_id_option_value_id_key" ON "product_variant_option_values"("variant_id", "option_value_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_idx" ON "product_images"("product_id");

-- CreateIndex
CREATE INDEX "product_variant_images_variant_id_idx" ON "product_variant_images"("variant_id");

-- CreateIndex
CREATE INDEX "product_tags_product_id_idx" ON "product_tags"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tags_product_id_tag_key" ON "product_tags"("product_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "product_seo_product_id_key" ON "product_seo"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_collections_name_key" ON "product_collections"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_collections_slug_key" ON "product_collections"("slug");

-- CreateIndex
CREATE INDEX "product_collections_slug_idx" ON "product_collections"("slug");

-- CreateIndex
CREATE INDEX "product_collections_is_active_idx" ON "product_collections"("is_active");

-- CreateIndex
CREATE INDEX "product_collections_deleted_at_idx" ON "product_collections"("deleted_at");

-- CreateIndex
CREATE INDEX "product_collection_maps_product_id_idx" ON "product_collection_maps"("product_id");

-- CreateIndex
CREATE INDEX "product_collection_maps_collection_id_idx" ON "product_collection_maps"("collection_id");

-- CreateIndex
CREATE INDEX "product_collection_maps_collection_id_sort_order_idx" ON "product_collection_maps"("collection_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_collection_maps_product_id_collection_id_key" ON "product_collection_maps"("product_id", "collection_id");

-- CreateIndex
CREATE INDEX "collection_audit_logs_collection_id_created_at_idx" ON "collection_audit_logs"("collection_id", "created_at");

-- CreateIndex
CREATE INDEX "collection_audit_logs_admin_id_created_at_idx" ON "collection_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "product_status_history_product_id_idx" ON "product_status_history"("product_id");

-- CreateIndex
CREATE INDEX "metafield_definitions_category_id_idx" ON "metafield_definitions"("category_id");

-- CreateIndex
CREATE INDEX "metafield_definitions_owner_type_idx" ON "metafield_definitions"("owner_type");

-- CreateIndex
CREATE INDEX "metafield_definitions_namespace_key_idx" ON "metafield_definitions"("namespace", "key");

-- CreateIndex
CREATE INDEX "metafield_definitions_is_required_category_id_idx" ON "metafield_definitions"("is_required", "category_id");

-- CreateIndex
CREATE INDEX "metafield_definitions_is_active_idx" ON "metafield_definitions"("is_active");

-- CreateIndex
CREATE INDEX "metafield_definitions_is_filterable_category_id_idx" ON "metafield_definitions"("is_filterable", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "metafield_definitions_namespace_key_category_id_key" ON "metafield_definitions"("namespace", "key", "category_id");

-- CreateIndex
CREATE INDEX "metafield_definition_audit_logs_metafield_definition_id_cre_idx" ON "metafield_definition_audit_logs"("metafield_definition_id", "created_at");

-- CreateIndex
CREATE INDEX "metafield_definition_audit_logs_admin_id_created_at_idx" ON "metafield_definition_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "product_metafields_product_id_idx" ON "product_metafields"("product_id");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_idx" ON "product_metafields"("metafield_definition_id");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_value_text_idx" ON "product_metafields"("metafield_definition_id", "value_text");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_value_numeric_idx" ON "product_metafields"("metafield_definition_id", "value_numeric");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_value_boolean_idx" ON "product_metafields"("metafield_definition_id", "value_boolean");

-- CreateIndex
CREATE UNIQUE INDEX "product_metafields_product_id_metafield_definition_id_key" ON "product_metafields"("product_id", "metafield_definition_id");

-- CreateIndex
CREATE INDEX "storefront_filters_metafield_definition_id_idx" ON "storefront_filters"("metafield_definition_id");

-- CreateIndex
CREATE INDEX "storefront_filters_scope_type_scope_id_idx" ON "storefront_filters"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "storefront_filters_is_active_sort_order_idx" ON "storefront_filters"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_razorpay_order_id_key" ON "checkout_sessions"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_master_order_id_key" ON "checkout_sessions"("master_order_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_status_expires_at_idx" ON "checkout_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_customer_id_status_idx" ON "checkout_sessions"("customer_id", "status");

-- CreateIndex
CREATE INDEX "cod_rules_active_priority_idx" ON "cod_rules"("active", "priority");

-- CreateIndex
CREATE INDEX "cod_decision_logs_customer_id_created_at_idx" ON "cod_decision_logs"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "cod_decision_logs_eligible_created_at_idx" ON "cod_decision_logs"("eligible", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payout_batches_batch_number_key" ON "payout_batches"("batch_number");

-- CreateIndex
CREATE INDEX "payout_batches_status_idx" ON "payout_batches"("status");

-- CreateIndex
CREATE INDEX "payouts_seller_id_idx" ON "payouts"("seller_id");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_batch_id_settlement_id_key" ON "payouts"("batch_id", "settlement_id");

-- CreateIndex
CREATE INDEX "bank_response_imports_payout_batch_id_idx" ON "bank_response_imports"("payout_batch_id");

-- CreateIndex
CREATE INDEX "bank_response_imports_imported_by_admin_id_idx" ON "bank_response_imports"("imported_by_admin_id");

-- CreateIndex
CREATE INDEX "bank_response_rows_import_id_idx" ON "bank_response_rows"("import_id");

-- CreateIndex
CREATE INDEX "bank_response_rows_settlement_id_idx" ON "bank_response_rows"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_records_order_item_id_key" ON "commission_records"("order_item_id");

-- CreateIndex
CREATE INDEX "commission_records_seller_id_idx" ON "commission_records"("seller_id");

-- CreateIndex
CREATE INDEX "commission_records_master_order_id_idx" ON "commission_records"("master_order_id");

-- CreateIndex
CREATE INDEX "commission_records_sub_order_id_idx" ON "commission_records"("sub_order_id");

-- CreateIndex
CREATE INDEX "commission_records_order_item_id_idx" ON "commission_records"("order_item_id");

-- CreateIndex
CREATE INDEX "commission_records_status_idx" ON "commission_records"("status");

-- CreateIndex
CREATE INDEX "commission_records_settlement_id_idx" ON "commission_records"("settlement_id");

-- CreateIndex
CREATE INDEX "commission_records_created_at_idx" ON "commission_records"("created_at");

-- CreateIndex
CREATE INDEX "commission_records_adjusted_at_idx" ON "commission_records"("adjusted_at");

-- CreateIndex
CREATE INDEX "commission_records_seller_id_created_at_idx" ON "commission_records"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "commission_reversal_records_commission_record_id_idx" ON "commission_reversal_records"("commission_record_id");

-- CreateIndex
CREATE INDEX "commission_reversal_records_return_id_idx" ON "commission_reversal_records"("return_id");

-- CreateIndex
CREATE INDEX "commission_reversal_records_created_at_idx" ON "commission_reversal_records"("created_at");

-- CreateIndex
CREATE INDEX "commission_hold_history_commission_record_id_created_at_idx" ON "commission_hold_history"("commission_record_id", "created_at");

-- CreateIndex
CREATE INDEX "commission_adjustment_history_commission_record_id_created__idx" ON "commission_adjustment_history"("commission_record_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commission_failures_sub_order_id_key" ON "commission_failures"("sub_order_id");

-- CreateIndex
CREATE INDEX "commission_failures_resolved_at_idx" ON "commission_failures"("resolved_at");

-- CreateIndex
CREATE INDEX "commission_failures_created_at_idx" ON "commission_failures"("created_at");

-- CreateIndex
CREATE INDEX "banners_slot_active_position_idx" ON "banners"("slot", "active", "position");

-- CreateIndex
CREATE INDEX "banners_scope_id_idx" ON "banners"("scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "static_pages_slug_key" ON "static_pages"("slug");

-- CreateIndex
CREATE INDEX "static_pages_published_idx" ON "static_pages"("published");

-- CreateIndex
CREATE INDEX "static_pages_status_idx" ON "static_pages"("status");

-- CreateIndex
CREATE INDEX "static_pages_deleted_at_idx" ON "static_pages"("deleted_at");

-- CreateIndex
CREATE INDEX "content_page_audit_logs_resource_type_resource_id_created_a_idx" ON "content_page_audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "content_page_audit_logs_actor_id_created_at_idx" ON "content_page_audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_content_blocks_slot_key" ON "storefront_content_blocks"("slot");

-- CreateIndex
CREATE INDEX "storefront_content_blocks_active_idx" ON "storefront_content_blocks"("active");

-- CreateIndex
CREATE INDEX "storefront_content_blocks_active_start_at_end_at_idx" ON "storefront_content_blocks"("active", "start_at", "end_at");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at");

-- CreateIndex
CREATE INDEX "blog_posts_category_status_idx" ON "blog_posts"("category", "status");

-- CreateIndex
CREATE INDEX "blog_posts_deleted_at_idx" ON "blog_posts"("deleted_at");

-- CreateIndex
CREATE INDEX "blog_post_audit_logs_post_id_created_at_idx" ON "blog_post_audit_logs"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "blog_post_audit_logs_actor_id_created_at_idx" ON "blog_post_audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_slot_definitions_slot_key_key" ON "storefront_slot_definitions"("slot_key");

-- CreateIndex
CREATE INDEX "storefront_slot_definitions_section_key_position_idx" ON "storefront_slot_definitions"("section_key", "position");

-- CreateIndex
CREATE INDEX "content_audit_logs_resource_type_resource_id_created_at_idx" ON "content_audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "content_audit_logs_actor_id_created_at_idx" ON "content_audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "faq_entries_slug_key" ON "faq_entries"("slug");

-- CreateIndex
CREATE INDEX "faq_entries_category_active_position_idx" ON "faq_entries"("category", "active", "position");

-- CreateIndex
CREATE INDEX "faq_entries_deleted_at_idx" ON "faq_entries"("deleted_at");

-- CreateIndex
CREATE INDEX "cron_runs_job_name_started_at_idx" ON "cron_runs"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "cron_runs_status_started_at_idx" ON "cron_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "customer_abuse_counters_requires_manual_approval_idx" ON "customer_abuse_counters"("requires_manual_approval");

-- CreateIndex
CREATE INDEX "customer_abuse_counters_return_rate_bps_idx" ON "customer_abuse_counters"("return_rate_bps");

-- CreateIndex
CREATE INDEX "data_erasure_requests_status_not_before_idx" ON "data_erasure_requests"("status", "not_before");

-- CreateIndex
CREATE INDEX "data_erasure_requests_subject_type_subject_id_idx" ON "data_erasure_requests"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_code_key" ON "discounts"("code");

-- CreateIndex
CREATE INDEX "discounts_code_idx" ON "discounts"("code");

-- CreateIndex
CREATE INDEX "discounts_status_idx" ON "discounts"("status");

-- CreateIndex
CREATE INDEX "discounts_funding_type_idx" ON "discounts"("funding_type");

-- CreateIndex
CREATE INDEX "discounts_affiliate_id_idx" ON "discounts"("affiliate_id");

-- CreateIndex
CREATE INDEX "discount_products_discount_id_idx" ON "discount_products"("discount_id");

-- CreateIndex
CREATE INDEX "discount_products_product_id_idx" ON "discount_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_products_discount_id_product_id_scope_key" ON "discount_products"("discount_id", "product_id", "scope");

-- CreateIndex
CREATE INDEX "discount_collections_discount_id_idx" ON "discount_collections"("discount_id");

-- CreateIndex
CREATE INDEX "discount_collections_collection_id_idx" ON "discount_collections"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_collections_discount_id_collection_id_scope_key" ON "discount_collections"("discount_id", "collection_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_codes_discount_id_idx" ON "discount_codes"("discount_id");

-- CreateIndex
CREATE INDEX "discount_codes_assigned_customer_id_idx" ON "discount_codes"("assigned_customer_id");

-- CreateIndex
CREATE INDEX "discount_codes_assigned_affiliate_id_idx" ON "discount_codes"("assigned_affiliate_id");

-- CreateIndex
CREATE INDEX "discount_codes_status_idx" ON "discount_codes"("status");

-- CreateIndex
CREATE INDEX "discount_redemptions_discount_id_idx" ON "discount_redemptions"("discount_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_discount_code_id_idx" ON "discount_redemptions"("discount_code_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_customer_id_idx" ON "discount_redemptions"("customer_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_master_order_id_idx" ON "discount_redemptions"("master_order_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_status_idx" ON "discount_redemptions"("status");

-- CreateIndex
CREATE INDEX "discount_redemptions_expires_at_idx" ON "discount_redemptions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_discount_code_id_customer_id_status_id_key" ON "discount_redemptions"("discount_code_id", "customer_id", "status", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_discounts_master_order_id_idx" ON "order_discounts"("master_order_id");

-- CreateIndex
CREATE INDEX "order_discounts_discount_id_idx" ON "order_discounts"("discount_id");

-- CreateIndex
CREATE INDEX "order_discounts_discount_code_idx" ON "order_discounts"("discount_code");

-- CreateIndex
CREATE INDEX "order_item_discounts_master_order_id_idx" ON "order_item_discounts"("master_order_id");

-- CreateIndex
CREATE INDEX "order_item_discounts_sub_order_id_idx" ON "order_item_discounts"("sub_order_id");

-- CreateIndex
CREATE INDEX "order_item_discounts_order_item_id_idx" ON "order_item_discounts"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_discounts_seller_id_idx" ON "order_item_discounts"("seller_id");

-- CreateIndex
CREATE INDEX "order_item_discounts_discount_id_idx" ON "order_item_discounts"("discount_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_master_order_id_idx" ON "discount_liability_ledger"("master_order_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_sub_order_id_idx" ON "discount_liability_ledger"("sub_order_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_order_item_id_idx" ON "discount_liability_ledger"("order_item_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_seller_id_idx" ON "discount_liability_ledger"("seller_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_franchise_id_idx" ON "discount_liability_ledger"("franchise_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_brand_id_idx" ON "discount_liability_ledger"("brand_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_discount_id_idx" ON "discount_liability_ledger"("discount_id");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_liability_party_idx" ON "discount_liability_ledger"("liability_party");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_status_idx" ON "discount_liability_ledger"("status");

-- CreateIndex
CREATE INDEX "discount_liability_ledger_settlement_cycle_id_idx" ON "discount_liability_ledger"("settlement_cycle_id");

-- CreateIndex
CREATE INDEX "discount_eligibility_rules_discount_id_idx" ON "discount_eligibility_rules"("discount_id");

-- CreateIndex
CREATE INDEX "discount_eligibility_rules_rule_type_idx" ON "discount_eligibility_rules"("rule_type");

-- CreateIndex
CREATE INDEX "coupon_attempts_customer_id_created_at_idx" ON "coupon_attempts"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "coupon_attempts_ip_address_created_at_idx" ON "coupon_attempts"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "coupon_attempts_ip_hash_created_at_idx" ON "coupon_attempts"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "coupon_attempts_result_created_at_idx" ON "coupon_attempts"("result", "created_at");

-- CreateIndex
CREATE INDEX "coupon_attempts_code_attempted_idx" ON "coupon_attempts"("code_attempted");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_dispute_number_key" ON "disputes"("dispute_number");

-- CreateIndex
CREATE INDEX "disputes_status_severity_created_at_idx" ON "disputes"("status", "severity" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "disputes_filed_by_type_filed_by_id_idx" ON "disputes"("filed_by_type", "filed_by_id");

-- CreateIndex
CREATE INDEX "disputes_master_order_id_idx" ON "disputes"("master_order_id");

-- CreateIndex
CREATE INDEX "disputes_sub_order_id_idx" ON "disputes"("sub_order_id");

-- CreateIndex
CREATE INDEX "disputes_return_id_idx" ON "disputes"("return_id");

-- CreateIndex
CREATE INDEX "disputes_source_ticket_id_idx" ON "disputes"("source_ticket_id");

-- CreateIndex
CREATE INDEX "disputes_assigned_admin_id_status_idx" ON "disputes"("assigned_admin_id", "status");

-- CreateIndex
CREATE INDEX "disputes_decision_by_admin_id_decision_at_idx" ON "disputes"("decision_by_admin_id", "decision_at");

-- CreateIndex
CREATE INDEX "disputes_liability_party_decision_at_idx" ON "disputes"("liability_party", "decision_at");

-- CreateIndex
CREATE INDEX "disputes_customer_remedy_decision_at_idx" ON "disputes"("customer_remedy", "decision_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_messages_mirrored_from_ticket_message_id_key" ON "dispute_messages"("mirrored_from_ticket_message_id");

-- CreateIndex
CREATE INDEX "dispute_messages_dispute_id_created_at_idx" ON "dispute_messages"("dispute_id", "created_at");

-- CreateIndex
CREATE INDEX "dispute_messages_dispute_id_is_internal_note_created_at_idx" ON "dispute_messages"("dispute_id", "is_internal_note", "created_at");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");

-- CreateIndex
CREATE INDEX "e_way_bills_status_idx" ON "e_way_bills"("status");

-- CreateIndex
CREATE INDEX "e_way_bills_supplier_gstin_idx" ON "e_way_bills"("supplier_gstin");

-- CreateIndex
CREATE INDEX "e_way_bills_override_admin_id_idx" ON "e_way_bills"("override_admin_id");

-- CreateIndex
CREATE INDEX "e_way_bills_from_state_code_to_state_code_idx" ON "e_way_bills"("from_state_code", "to_state_code");

-- CreateIndex
CREATE INDEX "e_way_bills_valid_until_status_idx" ON "e_way_bills"("valid_until", "status");

-- CreateIndex
CREATE INDEX "e_way_bills_retention_expires_at_idx" ON "e_way_bills"("retention_expires_at");

-- CreateIndex
CREATE INDEX "e_way_bills_cancelled_at_idx" ON "e_way_bills"("cancelled_at");

-- CreateIndex
CREATE INDEX "e_way_bill_audit_logs_eway_bill_id_created_at_idx" ON "e_way_bill_audit_logs"("eway_bill_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "e_way_bill_audit_logs_action_created_at_idx" ON "e_way_bill_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "file_url_audits_file_id_created_at_idx" ON "file_url_audits"("file_id", "created_at");

-- CreateIndex
CREATE INDEX "file_url_audits_requester_id_created_at_idx" ON "file_url_audits"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "file_url_audits_denied_created_at_idx" ON "file_url_audits"("denied", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_metadata_storage_key_key" ON "file_metadata"("storage_key");

-- CreateIndex
CREATE INDEX "file_metadata_uploaded_by_idx" ON "file_metadata"("uploaded_by");

-- CreateIndex
CREATE INDEX "file_metadata_classification_idx" ON "file_metadata"("classification");

-- CreateIndex
CREATE INDEX "file_metadata_status_idx" ON "file_metadata"("status");

-- CreateIndex
CREATE INDEX "file_metadata_purpose_idx" ON "file_metadata"("purpose");

-- CreateIndex
CREATE INDEX "file_metadata_deleted_at_idx" ON "file_metadata"("deleted_at");

-- CreateIndex
CREATE INDEX "file_metadata_status_last_verified_at_idx" ON "file_metadata"("status", "last_verified_at");

-- CreateIndex
CREATE INDEX "file_attachments_resource_resource_id_idx" ON "file_attachments"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "file_attachments_file_id_idx" ON "file_attachments"("file_id");

-- CreateIndex
CREATE INDEX "file_attachments_resource_resource_id_created_at_idx" ON "file_attachments"("resource", "resource_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_attachments_file_id_resource_resource_id_key" ON "file_attachments"("file_id", "resource", "resource_id");

-- CreateIndex
CREATE INDEX "shipment_evidence_sub_order_id_kind_deleted_at_idx" ON "shipment_evidence"("sub_order_id", "kind", "deleted_at");

-- CreateIndex
CREATE INDEX "shipment_evidence_sub_order_id_captured_at_idx" ON "shipment_evidence"("sub_order_id", "captured_at");

-- CreateIndex
CREATE INDEX "shipment_evidence_content_sha256_idx" ON "shipment_evidence"("content_sha256");

-- CreateIndex
CREATE INDEX "shipment_evidence_pending_upload_created_at_idx" ON "shipment_evidence"("pending_upload", "created_at");

-- CreateIndex
CREATE INDEX "shipment_evidence_retention_expires_at_idx" ON "shipment_evidence"("retention_expires_at");

-- CreateIndex
CREATE INDEX "shipment_evidence_audits_shipment_evidence_id_created_at_idx" ON "shipment_evidence_audits"("shipment_evidence_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "shipment_evidence_audits_actor_id_created_at_idx" ON "shipment_evidence_audits"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_evidence_policies_scope_key" ON "shipment_evidence_policies"("scope");

-- CreateIndex
CREATE INDEX "shipment_evidence_policies_active_priority_idx" ON "shipment_evidence_policies"("active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_reversals_idempotency_key_key" ON "franchise_reversals"("idempotency_key");

-- CreateIndex
CREATE INDEX "franchise_reversals_franchise_id_status_requested_at_idx" ON "franchise_reversals"("franchise_id", "status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "franchise_reversals_status_requested_at_idx" ON "franchise_reversals"("status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "franchise_reversals_sub_order_id_idx" ON "franchise_reversals"("sub_order_id");

-- CreateIndex
CREATE INDEX "franchise_reversal_items_reversal_id_idx" ON "franchise_reversal_items"("reversal_id");

-- CreateIndex
CREATE INDEX "franchise_reversal_items_order_item_id_idx" ON "franchise_reversal_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_franchise_code_key" ON "franchise_partners"("franchise_code");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_email_key" ON "franchise_partners"("email");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_phone_number_key" ON "franchise_partners"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_gst_number_key" ON "franchise_partners"("gst_number");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partners_pan_number_key" ON "franchise_partners"("pan_number");

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
CREATE INDEX "franchise_partners_is_deleted_idx" ON "franchise_partners"("is_deleted");

-- CreateIndex
CREATE INDEX "franchise_partners_verification_status_idx" ON "franchise_partners"("verification_status");

-- CreateIndex
CREATE INDEX "franchise_partners_contract_end_date_idx" ON "franchise_partners"("contract_end_date");

-- CreateIndex
CREATE INDEX "franchise_partners_fulfillment_hold_idx" ON "franchise_partners"("fulfillment_hold");

-- CreateIndex
CREATE INDEX "franchise_partner_registrations_franchise_id_idx" ON "franchise_partner_registrations"("franchise_id");

-- CreateIndex
CREATE INDEX "franchise_partner_registrations_partner_status_idx" ON "franchise_partner_registrations"("partner", "status");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partner_registrations_franchise_id_partner_key" ON "franchise_partner_registrations"("franchise_id", "partner");

-- CreateIndex
CREATE INDEX "franchise_status_history_franchise_id_created_at_idx" ON "franchise_status_history"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_verification_events_franchise_id_created_at_idx" ON "franchise_verification_events"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_procurement_prices_franchise_id_idx" ON "franchise_procurement_prices"("franchise_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_procurement_prices_franchise_id_product_id_varian_key" ON "franchise_procurement_prices"("franchise_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "franchise_procurement_price_history_franchise_id_product_id_idx" ON "franchise_procurement_price_history"("franchise_id", "product_id", "variant_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_pincode_mappings_pincode_is_active_idx" ON "franchise_pincode_mappings"("pincode", "is_active");

-- CreateIndex
CREATE INDEX "franchise_pincode_mappings_franchise_id_is_active_idx" ON "franchise_pincode_mappings"("franchise_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_pincode_mappings_franchise_id_pincode_key" ON "franchise_pincode_mappings"("franchise_id", "pincode");

-- CreateIndex
CREATE INDEX "franchise_pincode_mapping_events_franchise_id_created_at_idx" ON "franchise_pincode_mapping_events"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_pincode_mapping_events_mapping_id_idx" ON "franchise_pincode_mapping_events"("mapping_id");

-- CreateIndex
CREATE INDEX "franchise_sessions_franchise_partner_id_idx" ON "franchise_sessions"("franchise_partner_id");

-- CreateIndex
CREATE INDEX "franchise_sessions_refresh_token_idx" ON "franchise_sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "franchise_sessions_previous_refresh_token_hash_idx" ON "franchise_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "franchise_sessions_franchise_partner_id_revoked_at_idx" ON "franchise_sessions"("franchise_partner_id", "revoked_at");

-- CreateIndex
CREATE INDEX "franchise_sessions_franchise_partner_id_expires_at_idx" ON "franchise_sessions"("franchise_partner_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_bank_details_franchise_partner_id_key" ON "franchise_bank_details"("franchise_partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_password_reset_otps_reset_token_key" ON "franchise_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "franchise_password_reset_otps_franchise_partner_id_idx" ON "franchise_password_reset_otps"("franchise_partner_id");

-- CreateIndex
CREATE INDEX "franchise_password_reset_otps_franchise_partner_id_purpose_idx" ON "franchise_password_reset_otps"("franchise_partner_id", "purpose");

-- CreateIndex
CREATE INDEX "franchise_password_reset_otps_expires_at_idx" ON "franchise_password_reset_otps"("expires_at");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_franchise_id_is_active_idx" ON "franchise_catalog_mappings"("franchise_id", "is_active");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_product_id_idx" ON "franchise_catalog_mappings"("product_id");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_approval_status_idx" ON "franchise_catalog_mappings"("approval_status");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_franchise_id_approval_status_idx" ON "franchise_catalog_mappings"("franchise_id", "approval_status");

-- CreateIndex
CREATE INDEX "franchise_catalog_mappings_variant_id_idx" ON "franchise_catalog_mappings"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_catalog_mappings_franchise_id_product_id_variant__key" ON "franchise_catalog_mappings"("franchise_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "franchise_catalog_mapping_events_franchise_id_created_at_idx" ON "franchise_catalog_mapping_events"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_catalog_mapping_events_mapping_id_idx" ON "franchise_catalog_mapping_events"("mapping_id");

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
CREATE INDEX "procurement_requests_status_sla_approve_by_idx" ON "procurement_requests"("status", "sla_approve_by");

-- CreateIndex
CREATE INDEX "procurement_request_events_procurement_request_id_created_a_idx" ON "procurement_request_events"("procurement_request_id", "created_at");

-- CreateIndex
CREATE INDEX "procurement_request_items_procurement_request_id_idx" ON "procurement_request_items"("procurement_request_id");

-- CreateIndex
CREATE INDEX "procurement_request_items_product_id_idx" ON "procurement_request_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_pos_sales_sale_number_key" ON "franchise_pos_sales"("sale_number");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_franchise_id_sold_at_idx" ON "franchise_pos_sales"("franchise_id", "sold_at");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_status_idx" ON "franchise_pos_sales"("status");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_sale_number_idx" ON "franchise_pos_sales"("sale_number");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_franchise_id_payment_method_sold_at_idx" ON "franchise_pos_sales"("franchise_id", "payment_method", "sold_at");

-- CreateIndex
CREATE INDEX "franchise_pos_sales_franchise_id_status_sold_at_idx" ON "franchise_pos_sales"("franchise_id", "status", "sold_at");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_pos_returns_return_number_key" ON "franchise_pos_returns"("return_number");

-- CreateIndex
CREATE INDEX "franchise_pos_returns_sale_id_idx" ON "franchise_pos_returns"("sale_id");

-- CreateIndex
CREATE INDEX "franchise_pos_returns_franchise_id_returned_at_idx" ON "franchise_pos_returns"("franchise_id", "returned_at");

-- CreateIndex
CREATE INDEX "franchise_pos_return_items_return_id_idx" ON "franchise_pos_return_items"("return_id");

-- CreateIndex
CREATE INDEX "franchise_pos_return_items_sale_item_id_idx" ON "franchise_pos_return_items"("sale_item_id");

-- CreateIndex
CREATE INDEX "franchise_pos_reconciliations_franchise_id_business_date_idx" ON "franchise_pos_reconciliations"("franchise_id", "business_date");

-- CreateIndex
CREATE INDEX "franchise_pos_reconciliations_status_idx" ON "franchise_pos_reconciliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_pos_reconciliations_franchise_id_business_date_key" ON "franchise_pos_reconciliations"("franchise_id", "business_date");

-- CreateIndex
CREATE INDEX "franchise_pos_sale_items_sale_id_idx" ON "franchise_pos_sale_items"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_finance_ledger_idempotency_key_key" ON "franchise_finance_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_franchise_id_status_idx" ON "franchise_finance_ledger"("franchise_id", "status");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_source_type_source_id_idx" ON "franchise_finance_ledger"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_settlement_batch_id_idx" ON "franchise_finance_ledger"("settlement_batch_id");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_created_at_idx" ON "franchise_finance_ledger"("created_at");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_franchise_id_created_at_idx" ON "franchise_finance_ledger"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_franchise_id_source_type_created_a_idx" ON "franchise_finance_ledger"("franchise_id", "source_type", "created_at");

-- CreateIndex
CREATE INDEX "franchise_finance_ledger_created_by_admin_id_created_at_idx" ON "franchise_finance_ledger"("created_by_admin_id", "created_at");

-- CreateIndex
CREATE INDEX "franchise_ledger_status_history_ledger_entry_id_idx" ON "franchise_ledger_status_history"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "franchise_penalty_approvals_status_created_at_idx" ON "franchise_penalty_approvals"("status", "created_at");

-- CreateIndex
CREATE INDEX "franchise_penalty_approvals_franchise_id_idx" ON "franchise_penalty_approvals"("franchise_id");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_settlements_payment_reference_key" ON "franchise_settlements"("payment_reference");

-- CreateIndex
CREATE INDEX "franchise_settlements_cycle_id_idx" ON "franchise_settlements"("cycle_id");

-- CreateIndex
CREATE INDEX "franchise_settlements_franchise_id_idx" ON "franchise_settlements"("franchise_id");

-- CreateIndex
CREATE INDEX "franchise_settlements_status_idx" ON "franchise_settlements"("status");

-- CreateIndex
CREATE INDEX "franchise_settlements_status_payout_due_by_idx" ON "franchise_settlements"("status", "payout_due_by");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_settlements_cycle_id_franchise_id_key" ON "franchise_settlements"("cycle_id", "franchise_id");

-- CreateIndex
CREATE INDEX "franchise_settlement_charge_lines_settlement_id_idx" ON "franchise_settlement_charge_lines"("settlement_id");

-- CreateIndex
CREATE INDEX "franchise_settlement_adjustments_settlement_id_idx" ON "franchise_settlement_adjustments"("settlement_id");

-- CreateIndex
CREATE INDEX "franchise_settlement_adjustments_franchise_id_status_idx" ON "franchise_settlement_adjustments"("franchise_id", "status");

-- CreateIndex
CREATE INDEX "franchise_staff_franchise_id_is_active_idx" ON "franchise_staff"("franchise_id", "is_active");

-- CreateIndex
CREATE INDEX "franchise_staff_franchise_id_status_idx" ON "franchise_staff"("franchise_id", "status");

-- CreateIndex
CREATE INDEX "franchise_staff_invite_token_hash_idx" ON "franchise_staff"("invite_token_hash");

-- CreateIndex
CREATE INDEX "franchise_staff_sessions_staff_id_idx" ON "franchise_staff_sessions"("staff_id");

-- CreateIndex
CREATE INDEX "franchise_staff_sessions_refresh_token_idx" ON "franchise_staff_sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "franchise_staff_sessions_staff_id_revoked_at_idx" ON "franchise_staff_sessions"("staff_id", "revoked_at");

-- CreateIndex
CREATE INDEX "gst_tcs_settlement_ledger_filing_period_idx" ON "gst_tcs_settlement_ledger"("filing_period");

-- CreateIndex
CREATE INDEX "gst_tcs_settlement_ledger_seller_id_filing_period_idx" ON "gst_tcs_settlement_ledger"("seller_id", "filing_period");

-- CreateIndex
CREATE INDEX "gst_tcs_settlement_ledger_franchise_id_filing_period_idx" ON "gst_tcs_settlement_ledger"("franchise_id", "filing_period");

-- CreateIndex
CREATE INDEX "gst_tcs_settlement_ledger_status_idx" ON "gst_tcs_settlement_ledger"("status");

-- CreateIndex
CREATE INDEX "gst_tcs_settlement_ledger_status_filing_period_idx" ON "gst_tcs_settlement_ledger"("status", "filing_period");

-- CreateIndex
CREATE INDEX "gst_tcs_settlement_ledger_supplier_gstin_idx" ON "gst_tcs_settlement_ledger"("supplier_gstin");

-- CreateIndex
CREATE INDEX "gst_tcs_ledger_event_ledger_id_created_at_idx" ON "gst_tcs_ledger_event"("ledger_id", "created_at");

-- CreateIndex
CREATE INDEX "gst_tcs_ledger_event_event_type_idx" ON "gst_tcs_ledger_event"("event_type");

-- CreateIndex
CREATE INDEX "i18n_messages_key_idx" ON "i18n_messages"("key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_state_created_at_idx" ON "idempotency_keys"("state", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_actor_type_actor_id_idx" ON "idempotency_keys"("actor_type", "actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_module_action_key" ON "permissions"("module", "action");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_user_id_role_id_key" ON "role_assignments"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_refresh_token_hash_idx" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_previous_refresh_token_hash_idx" ON "sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_otps_reset_token_key" ON "password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "password_reset_otps_user_id_idx" ON "password_reset_otps"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_otps_user_id_idx" ON "email_verification_otps"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_otps_expires_at_idx" ON "email_verification_otps"("expires_at");

-- CreateIndex
CREATE INDEX "consent_records_user_id_idx" ON "consent_records"("user_id");

-- CreateIndex
CREATE INDEX "consent_records_purpose_granted_idx" ON "consent_records"("purpose", "granted");

-- CreateIndex
CREATE UNIQUE INDEX "consent_records_user_id_purpose_key" ON "consent_records"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "section_194o_tds_ledger_seller_id_filing_period_idx" ON "section_194o_tds_ledger"("seller_id", "filing_period");

-- CreateIndex
CREATE INDEX "section_194o_tds_ledger_franchise_id_filing_period_idx" ON "section_194o_tds_ledger"("franchise_id", "filing_period");

-- CreateIndex
CREATE INDEX "section_194o_tds_ledger_filing_period_idx" ON "section_194o_tds_ledger"("filing_period");

-- CreateIndex
CREATE INDEX "section_194o_tds_ledger_status_idx" ON "section_194o_tds_ledger"("status");

-- CreateIndex
CREATE INDEX "seller_debits_seller_id_status_idx" ON "seller_debits"("seller_id", "status");

-- CreateIndex
CREATE INDEX "seller_debits_settlement_id_idx" ON "seller_debits"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_debits_source_type_source_id_key" ON "seller_debits"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "logistics_claims_status_idx" ON "logistics_claims"("status");

-- CreateIndex
CREATE INDEX "logistics_claims_awb_number_idx" ON "logistics_claims"("awb_number");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_claims_source_type_source_id_key" ON "logistics_claims"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "platform_expenses_expense_type_idx" ON "platform_expenses"("expense_type");

-- CreateIndex
CREATE UNIQUE INDEX "platform_expenses_source_type_source_id_key" ON "platform_expenses"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "admin_tasks_status_idx" ON "admin_tasks"("status");

-- CreateIndex
CREATE INDEX "admin_tasks_assigned_to_idx" ON "admin_tasks"("assigned_to");

-- CreateIndex
CREATE INDEX "admin_tasks_status_sla_breach_at_idx" ON "admin_tasks"("status", "sla_breach_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_tasks_kind_source_type_source_id_key" ON "admin_tasks"("kind", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "flash_sales_is_active_starts_at_ends_at_idx" ON "flash_sales"("is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "sport_events_is_active_starts_at_idx" ON "sport_events"("is_active", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_key" ON "notification_templates"("key");

-- CreateIndex
CREATE INDEX "notification_template_history_template_id_changed_at_idx" ON "notification_template_history"("template_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "notification_template_history_template_key_version_idx" ON "notification_template_history"("template_key", "version");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_event_class_channel_key" ON "notification_preferences"("user_id", "event_class", "channel");

-- CreateIndex
CREATE INDEX "notification_preference_history_user_id_occurred_at_idx" ON "notification_preference_history"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "notification_preference_history_event_class_channel_idx" ON "notification_preference_history"("event_class", "channel");

-- CreateIndex
CREATE INDEX "notification_suppressions_destination_idx" ON "notification_suppressions"("destination");

-- CreateIndex
CREATE INDEX "notification_suppressions_expires_at_idx" ON "notification_suppressions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_suppressions_channel_destination_key" ON "notification_suppressions"("channel", "destination");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_phone_e164_key" ON "whatsapp_sessions"("phone_e164");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_customer_id_idx" ON "whatsapp_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_opted_out_at_idx" ON "whatsapp_sessions"("opted_out_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_inbound_provider_message_id_key" ON "whatsapp_inbound"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_inbound_from_phone_e164_received_at_idx" ON "whatsapp_inbound"("from_phone_e164", "received_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_inbound_received_at_idx" ON "whatsapp_inbound"("received_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_inbound_customer_id_received_at_idx" ON "whatsapp_inbound"("customer_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_statuses_provider_message_id_idx" ON "whatsapp_statuses"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_statuses_received_at_idx" ON "whatsapp_statuses"("received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_statuses_provider_message_id_status_key" ON "whatsapp_statuses"("provider_message_id", "status");

-- CreateIndex
CREATE INDEX "notification_logs_recipient_id_created_at_idx" ON "notification_logs"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_event_type_event_id_idx" ON "notification_logs"("event_type", "event_id");

-- CreateIndex
CREATE INDEX "notification_logs_channel_status_created_at_idx" ON "notification_logs"("channel", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_provider_message_id_idx" ON "notification_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_logs_failure_code_idx" ON "notification_logs"("failure_code");

-- CreateIndex
CREATE INDEX "notification_logs_outbox_event_id_idx" ON "notification_logs"("outbox_event_id");

-- CreateIndex
CREATE INDEX "notification_logs_parent_log_id_idx" ON "notification_logs"("parent_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_dispatches_event_id_key" ON "notification_dispatches"("event_id");

-- CreateIndex
CREATE INDEX "notification_dispatches_dispatched_by_admin_id_created_at_idx" ON "notification_dispatches"("dispatched_by_admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_dispatches_recipient_id_created_at_idx" ON "notification_dispatches"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_dispatches_dispatch_path_created_at_idx" ON "notification_dispatches"("dispatch_path", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE INDEX "customer_addresses_state_code_idx" ON "customer_addresses"("state_code");

-- CreateIndex
CREATE INDEX "customer_addresses_deleted_at_idx" ON "customer_addresses"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "carts_customer_id_key" ON "carts"("customer_id");

-- CreateIndex
CREATE INDEX "carts_last_activity_at_idx" ON "carts"("last_activity_at");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items"("cart_id");

-- CreateIndex
CREATE INDEX "cart_items_updated_at_idx" ON "cart_items"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "master_orders_order_number_key" ON "master_orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "master_orders_idempotency_key_key" ON "master_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "master_orders_customer_id_idx" ON "master_orders"("customer_id");

-- CreateIndex
CREATE INDEX "master_orders_order_number_idx" ON "master_orders"("order_number");

-- CreateIndex
CREATE INDEX "master_orders_selected_tax_profile_id_idx" ON "master_orders"("selected_tax_profile_id");

-- CreateIndex
CREATE INDEX "master_orders_order_status_idx" ON "master_orders"("order_status");

-- CreateIndex
CREATE INDEX "master_orders_customer_id_created_at_idx" ON "master_orders"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "master_orders_order_status_payment_expires_at_idx" ON "master_orders"("order_status", "payment_expires_at");

-- CreateIndex
CREATE INDEX "master_orders_order_status_verification_deadline_at_idx" ON "master_orders"("order_status", "verification_deadline_at");

-- CreateIndex
CREATE INDEX "master_orders_order_status_verification_risk_band_created_a_idx" ON "master_orders"("order_status", "verification_risk_band", "created_at");

-- CreateIndex
CREATE INDEX "master_orders_payment_method_order_status_payment_status_idx" ON "master_orders"("payment_method", "order_status", "payment_status");

-- CreateIndex
CREATE INDEX "master_orders_wallet_transaction_id_idx" ON "master_orders"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "cash_collections_master_order_id_idx" ON "cash_collections"("master_order_id");

-- CreateIndex
CREATE INDEX "cash_collections_sub_order_id_idx" ON "cash_collections"("sub_order_id");

-- CreateIndex
CREATE INDEX "cash_collections_collected_by_admin_id_idx" ON "cash_collections"("collected_by_admin_id");

-- CreateIndex
CREATE INDEX "cash_collections_collected_at_idx" ON "cash_collections"("collected_at");

-- CreateIndex
CREATE INDEX "sub_orders_master_order_id_idx" ON "sub_orders"("master_order_id");

-- CreateIndex
CREATE INDEX "sub_orders_seller_id_idx" ON "sub_orders"("seller_id");

-- CreateIndex
CREATE INDEX "sub_orders_franchise_id_idx" ON "sub_orders"("franchise_id");

-- CreateIndex
CREATE INDEX "sub_orders_fulfillment_node_type_idx" ON "sub_orders"("fulfillment_node_type");

-- CreateIndex
CREATE INDEX "sub_orders_delivery_method_idx" ON "sub_orders"("delivery_method");

-- CreateIndex
CREATE INDEX "sub_orders_self_delivery_status_idx" ON "sub_orders"("self_delivery_status");

-- CreateIndex
CREATE INDEX "sub_orders_accept_status_accept_deadline_at_idx" ON "sub_orders"("accept_status", "accept_deadline_at");

-- CreateIndex
CREATE INDEX "sub_orders_accept_status_fulfillment_node_type_accept_deadl_idx" ON "sub_orders"("accept_status", "fulfillment_node_type", "accept_deadline_at");

-- CreateIndex
CREATE INDEX "sub_orders_rejection_type_auto_rejected_at_idx" ON "sub_orders"("rejection_type", "auto_rejected_at");

-- CreateIndex
CREATE INDEX "sub_orders_cancellation_source_cancelled_at_idx" ON "sub_orders"("cancellation_source", "cancelled_at");

-- CreateIndex
CREATE INDEX "sub_orders_cancelled_by_cancelled_at_idx" ON "sub_orders"("cancelled_by", "cancelled_at");

-- CreateIndex
CREATE INDEX "sub_orders_seller_id_packed_at_idx" ON "sub_orders"("seller_id", "packed_at");

-- CreateIndex
CREATE INDEX "sub_orders_seller_id_shipped_at_idx" ON "sub_orders"("seller_id", "shipped_at");

-- CreateIndex
CREATE INDEX "sub_orders_franchise_id_packed_at_idx" ON "sub_orders"("franchise_id", "packed_at");

-- CreateIndex
CREATE INDEX "sub_orders_franchise_id_shipped_at_idx" ON "sub_orders"("franchise_id", "shipped_at");

-- CreateIndex
CREATE INDEX "sub_orders_commission_lock_scheduled_at_idx" ON "sub_orders"("commission_lock_scheduled_at");

-- CreateIndex
CREATE INDEX "sub_orders_delivery_source_delivered_at_idx" ON "sub_orders"("delivery_source", "delivered_at");

-- CreateIndex
CREATE INDEX "sub_orders_seller_id_accept_status_created_at_idx" ON "sub_orders"("seller_id", "accept_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sub_orders_franchise_id_accept_status_created_at_idx" ON "sub_orders"("franchise_id", "accept_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "order_items_sub_order_id_idx" ON "order_items"("sub_order_id");

-- CreateIndex
CREATE INDEX "order_items_item_kind_idx" ON "order_items"("item_kind");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_tax_config_snapshots_order_item_id_key" ON "order_item_tax_config_snapshots"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_risk_rule_configs_reason_code_key" ON "order_risk_rule_configs"("reason_code");

-- CreateIndex
CREATE INDEX "order_verification_decisions_master_order_id_decided_at_idx" ON "order_verification_decisions"("master_order_id", "decided_at" DESC);

-- CreateIndex
CREATE INDEX "order_verification_decisions_decided_by_decided_at_idx" ON "order_verification_decisions"("decided_by", "decided_at");

-- CreateIndex
CREATE INDEX "order_verification_decisions_decision_decided_at_idx" ON "order_verification_decisions"("decision", "decided_at");

-- CreateIndex
CREATE INDEX "order_claim_history_master_order_id_released_at_idx" ON "order_claim_history"("master_order_id", "released_at" DESC);

-- CreateIndex
CREATE INDEX "order_claim_history_claimed_by_admin_id_released_at_idx" ON "order_claim_history"("claimed_by_admin_id", "released_at");

-- CreateIndex
CREATE INDEX "order_claim_history_release_reason_released_at_idx" ON "order_claim_history"("release_reason", "released_at");

-- CreateIndex
CREATE INDEX "order_risk_score_history_master_order_id_scored_at_idx" ON "order_risk_score_history"("master_order_id", "scored_at" DESC);

-- CreateIndex
CREATE INDEX "order_risk_score_history_band_scored_at_idx" ON "order_risk_score_history"("band", "scored_at" DESC);

-- CreateIndex
CREATE INDEX "order_risk_reasons_master_order_id_idx" ON "order_risk_reasons"("master_order_id");

-- CreateIndex
CREATE INDEX "order_risk_reasons_reason_code_idx" ON "order_risk_reasons"("reason_code");

-- CreateIndex
CREATE INDEX "order_risk_reasons_reason_code_created_at_idx" ON "order_risk_reasons"("reason_code", "created_at");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_master_order_id_idx" ON "order_reassignment_logs"("master_order_id");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_sub_order_id_idx" ON "order_reassignment_logs"("sub_order_id");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_reassigned_by_created_at_idx" ON "order_reassignment_logs"("reassigned_by", "created_at");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_from_node_id_from_node_type_idx" ON "order_reassignment_logs"("from_node_id", "from_node_type");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_to_node_id_to_node_type_idx" ON "order_reassignment_logs"("to_node_id", "to_node_type");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_master_order_id_created_at_id_idx" ON "order_reassignment_logs"("master_order_id", "created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "order_reassignment_logs_event_type_created_at_idx" ON "order_reassignment_logs"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_master_order_id_created_at_id_idx" ON "order_status_history"("master_order_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "order_status_history_sub_order_id_created_at_idx" ON "order_status_history"("sub_order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_event_type_created_at_idx" ON "order_status_history"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_actor_id_created_at_idx" ON "order_status_history"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_master_order_id_visibility_created_at_idx" ON "order_status_history"("master_order_id", "visibility", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_history_idempotency_key_key" ON "order_status_history"("idempotency_key");

-- CreateIndex
CREATE INDEX "sub_order_awb_history_sub_order_id_attached_at_idx" ON "sub_order_awb_history"("sub_order_id", "attached_at" DESC);

-- CreateIndex
CREATE INDEX "sub_order_awb_history_awb_number_idx" ON "sub_order_awb_history"("awb_number");

-- CreateIndex
CREATE INDEX "low_stock_alerts_resolved_at_idx" ON "low_stock_alerts"("resolved_at");

-- CreateIndex
CREATE INDEX "low_stock_alerts_status_created_at_idx" ON "low_stock_alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "low_stock_alerts_seller_id_status_idx" ON "low_stock_alerts"("seller_id", "status");

-- CreateIndex
CREATE INDEX "low_stock_alerts_franchise_id_status_idx" ON "low_stock_alerts"("franchise_id", "status");

-- CreateIndex
CREATE INDEX "low_stock_alerts_product_id_variant_id_idx" ON "low_stock_alerts"("product_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "low_stock_alerts_seller_product_mapping_id_key" ON "low_stock_alerts"("seller_product_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "low_stock_alerts_franchise_stock_id_key" ON "low_stock_alerts"("franchise_stock_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_tax_snapshots_order_item_id_key" ON "order_item_tax_snapshots"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_master_order_id_idx" ON "order_item_tax_snapshots"("master_order_id");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_sub_order_id_idx" ON "order_item_tax_snapshots"("sub_order_id");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_line_type_idx" ON "order_item_tax_snapshots"("line_type");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_supplier_type_idx" ON "order_item_tax_snapshots"("supplier_type");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_seller_id_idx" ON "order_item_tax_snapshots"("seller_id");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_supply_taxability_idx" ON "order_item_tax_snapshots"("supply_taxability");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_tax_data_status_idx" ON "order_item_tax_snapshots"("tax_data_status");

-- CreateIndex
CREATE INDEX "order_item_tax_snapshots_seller_state_code_idx" ON "order_item_tax_snapshots"("seller_state_code");

-- CreateIndex
CREATE UNIQUE INDEX "sub_order_tax_summaries_sub_order_id_key" ON "sub_order_tax_summaries"("sub_order_id");

-- CreateIndex
CREATE INDEX "sub_order_tax_summaries_master_order_id_idx" ON "sub_order_tax_summaries"("master_order_id");

-- CreateIndex
CREATE INDEX "sub_order_tax_summaries_seller_id_idx" ON "sub_order_tax_summaries"("seller_id");

-- CreateIndex
CREATE INDEX "sub_order_tax_summaries_tax_data_status_idx" ON "sub_order_tax_summaries"("tax_data_status");

-- CreateIndex
CREATE INDEX "sub_order_tax_summaries_supplier_type_idx" ON "sub_order_tax_summaries"("supplier_type");

-- CreateIndex
CREATE UNIQUE INDEX "order_tax_summaries_master_order_id_key" ON "order_tax_summaries"("master_order_id");

-- CreateIndex
CREATE INDEX "order_tax_summaries_tax_data_status_idx" ON "order_tax_summaries"("tax_data_status");

-- CreateIndex
CREATE INDEX "outbox_events_state_next_attempt_at_idx" ON "outbox_events"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_aggregate_id_idx" ON "outbox_events"("aggregate", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE INDEX "outbox_events_dedupe_key_idx" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");

-- CreateIndex
CREATE INDEX "outbox_dead_letters_event_name_dead_at_idx" ON "outbox_dead_letters"("event_name", "dead_at");

-- CreateIndex
CREATE INDEX "outbox_dead_letters_aggregate_aggregate_id_idx" ON "outbox_dead_letters"("aggregate", "aggregate_id");

-- CreateIndex
CREATE INDEX "event_deduplication_handler_consumed_at_idx" ON "event_deduplication"("handler", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "own_brand_warehouses_code_key" ON "own_brand_warehouses"("code");

-- CreateIndex
CREATE INDEX "own_brand_stocks_product_id_idx" ON "own_brand_stocks"("product_id");

-- CreateIndex
CREATE INDEX "own_brand_stocks_variant_id_idx" ON "own_brand_stocks"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "own_brand_stocks_warehouse_id_product_id_variant_id_key" ON "own_brand_stocks"("warehouse_id", "product_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "own_brand_procurement_orders_po_number_key" ON "own_brand_procurement_orders"("po_number");

-- CreateIndex
CREATE INDEX "own_brand_procurement_orders_warehouse_id_status_idx" ON "own_brand_procurement_orders"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "own_brand_procurement_orders_po_number_idx" ON "own_brand_procurement_orders"("po_number");

-- CreateIndex
CREATE INDEX "own_brand_procurement_order_items_po_id_idx" ON "own_brand_procurement_order_items"("po_id");

-- CreateIndex
CREATE INDEX "own_brand_procurement_order_items_product_id_idx" ON "own_brand_procurement_order_items"("product_id");

-- CreateIndex
CREATE INDEX "own_brand_stock_movements_warehouse_id_product_id_variant_i_idx" ON "own_brand_stock_movements"("warehouse_id", "product_id", "variant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "own_brand_stock_movements_ref_type_ref_id_idx" ON "own_brand_stock_movements"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "own_brand_stock_movements_kind_created_at_idx" ON "own_brand_stock_movements"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "own_brand_procurement_receipts_po_id_created_at_idx" ON "own_brand_procurement_receipts"("po_id", "created_at");

-- CreateIndex
CREATE INDEX "own_brand_procurement_receipts_po_item_id_idx" ON "own_brand_procurement_receipts"("po_item_id");

-- CreateIndex
CREATE INDEX "payments_master_order_id_idx" ON "payments"("master_order_id");

-- CreateIndex
CREATE INDEX "payments_provider_order_id_idx" ON "payments"("provider_order_id");

-- CreateIndex
CREATE INDEX "payments_provider_payment_id_idx" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_attempts_master_order_id_kind_created_at_idx" ON "payment_attempts"("master_order_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_attempts_provider_payment_id_idx" ON "payment_attempts"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_attempts_status_created_at_idx" ON "payment_attempts"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_attempts_status_kind_created_at_idx" ON "payment_attempts"("status", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_mismatch_alerts_status_severity_created_at_idx" ON "payment_mismatch_alerts"("status", "severity" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_mismatch_alerts_master_order_id_idx" ON "payment_mismatch_alerts"("master_order_id");

-- CreateIndex
CREATE INDEX "payment_mismatch_alerts_provider_payment_id_idx" ON "payment_mismatch_alerts"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "chargebacks_provider_dispute_id_key" ON "chargebacks"("provider_dispute_id");

-- CreateIndex
CREATE INDEX "chargebacks_status_due_date_idx" ON "chargebacks"("status", "due_date");

-- CreateIndex
CREATE INDEX "chargebacks_provider_payment_id_idx" ON "chargebacks"("provider_payment_id");

-- CreateIndex
CREATE INDEX "chargebacks_master_order_id_idx" ON "chargebacks"("master_order_id");

-- CreateIndex
CREATE INDEX "chargebacks_evidence_status_due_date_idx" ON "chargebacks"("evidence_status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_event_key_key" ON "payment_webhook_events"("event_key");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_payment_id_idx" ON "payment_webhook_events"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_master_order_id_idx" ON "payment_webhook_events"("master_order_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_event_type_received_at_idx" ON "payment_webhook_events"("event_type", "received_at" DESC);

-- CreateIndex
CREATE INDEX "post_offices_pincode_idx" ON "post_offices"("pincode");

-- CreateIndex
CREATE INDEX "post_offices_district_idx" ON "post_offices"("district");

-- CreateIndex
CREATE INDEX "post_offices_state_idx" ON "post_offices"("state");

-- CreateIndex
CREATE UNIQUE INDEX "post_offices_pincode_office_name_key" ON "post_offices"("pincode", "office_name");

-- CreateIndex
CREATE INDEX "product_reviews_product_id_status_idx" ON "product_reviews"("product_id", "status");

-- CreateIndex
CREATE INDEX "product_reviews_status_created_at_idx" ON "product_reviews"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_reviews_product_id_user_id_key" ON "product_reviews"("product_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_run_number_key" ON "reconciliation_runs"("run_number");

-- CreateIndex
CREATE INDEX "reconciliation_runs_kind_period_start_idx" ON "reconciliation_runs"("kind", "period_start" DESC);

-- CreateIndex
CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs"("status");

-- CreateIndex
CREATE INDEX "reconciliation_runs_kind_status_idx" ON "reconciliation_runs"("kind", "status");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_run_id_idx" ON "reconciliation_discrepancies"("run_id");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_status_created_at_idx" ON "reconciliation_discrepancies"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_master_order_id_idx" ON "reconciliation_discrepancies"("master_order_id");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_status_severity_idx" ON "reconciliation_discrepancies"("status", "severity" DESC);

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_assigned_to_admin_id_status_idx" ON "reconciliation_discrepancies"("assigned_to_admin_id", "status");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancy_status_history_discrepancy_id_oc_idx" ON "reconciliation_discrepancy_status_history"("discrepancy_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "refund_instructions_idempotency_key_key" ON "refund_instructions"("idempotency_key");

-- CreateIndex
CREATE INDEX "refund_instructions_source_type_source_id_idx" ON "refund_instructions"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "refund_instructions_customer_id_idx" ON "refund_instructions"("customer_id");

-- CreateIndex
CREATE INDEX "refund_instructions_status_idx" ON "refund_instructions"("status");

-- CreateIndex
CREATE INDEX "refund_instructions_status_processed_at_idx" ON "refund_instructions"("status", "processed_at");

-- CreateIndex
CREATE INDEX "refund_instructions_refund_method_status_idx" ON "refund_instructions"("refund_method", "status");

-- CreateIndex
CREATE INDEX "refund_instructions_status_approval_due_by_idx" ON "refund_instructions"("status", "approval_due_by");

-- CreateIndex
CREATE INDEX "refund_instructions_linked_dispute_id_idx" ON "refund_instructions"("linked_dispute_id");

-- CreateIndex
CREATE INDEX "refund_instructions_is_goodwill_status_idx" ON "refund_instructions"("is_goodwill", "status");

-- CreateIndex
CREATE INDEX "refund_instruction_status_history_instruction_id_occurred_a_idx" ON "refund_instruction_status_history"("instruction_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_refund_webhook_events_event_id_key" ON "razorpay_refund_webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "razorpay_refund_webhook_events_refund_id_idx" ON "razorpay_refund_webhook_events"("refund_id");

-- CreateIndex
CREATE INDEX "razorpay_refund_webhook_events_received_at_idx" ON "razorpay_refund_webhook_events"("received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "refund_sagas_idempotency_key_key" ON "refund_sagas"("idempotency_key");

-- CreateIndex
CREATE INDEX "refund_sagas_status_started_at_idx" ON "refund_sagas"("status", "started_at");

-- CreateIndex
CREATE INDEX "refund_sagas_source_id_idx" ON "refund_sagas"("source_id");

-- CreateIndex
CREATE INDEX "refund_sagas_instruction_id_idx" ON "refund_sagas"("instruction_id");

-- CreateIndex
CREATE INDEX "retention_policies_enabled_idx" ON "retention_policies"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_resource_type_purpose_key" ON "retention_policies"("resource_type", "purpose");

-- CreateIndex
CREATE INDEX "retention_executions_policy_id_idx" ON "retention_executions"("policy_id");

-- CreateIndex
CREATE INDEX "retention_executions_resource_type_resource_id_idx" ON "retention_executions"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "retention_executions_executed_at_idx" ON "retention_executions"("executed_at");

-- CreateIndex
CREATE INDEX "return_eligibility_audits_master_order_id_created_at_idx" ON "return_eligibility_audits"("master_order_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "return_eligibility_audits_customer_id_created_at_idx" ON "return_eligibility_audits"("customer_id", "created_at");

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
CREATE INDEX "returns_liability_party_idx" ON "returns"("liability_party");

-- CreateIndex
CREATE INDEX "returns_customer_remedy_idx" ON "returns"("customer_remedy");

-- CreateIndex
CREATE INDEX "returns_seller_response_status_seller_response_due_at_idx" ON "returns"("seller_response_status", "seller_response_due_at");

-- CreateIndex
CREATE INDEX "returns_seller_id_snapshot_status_created_at_idx" ON "returns"("seller_id_snapshot", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "returns_franchise_id_snapshot_status_created_at_idx" ON "returns"("franchise_id_snapshot", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "returns_risk_score_idx" ON "returns"("risk_score");

-- CreateIndex
CREATE INDEX "returns_status_risk_score_idx" ON "returns"("status", "risk_score");

-- CreateIndex
CREATE INDEX "returns_replacement_status_idx" ON "returns"("replacement_status");

-- CreateIndex
CREATE INDEX "returns_status_created_at_idx" ON "returns"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "returns_status_received_at_idx" ON "returns"("status", "received_at");

-- CreateIndex
CREATE INDEX "returns_qc_decision_qc_completed_at_idx" ON "returns"("qc_decision", "qc_completed_at");

-- CreateIndex
CREATE INDEX "returns_liability_party_qc_completed_at_idx" ON "returns"("liability_party", "qc_completed_at");

-- CreateIndex
CREATE INDEX "returns_closed_at_idx" ON "returns"("closed_at" DESC);

-- CreateIndex
CREATE INDEX "returns_status_refund_next_retry_at_idx" ON "returns"("status", "refund_next_retry_at");

-- CreateIndex
CREATE INDEX "returns_credit_note_eligibility_status_idx" ON "returns"("credit_note_eligibility_status");

-- CreateIndex
CREATE INDEX "returns_created_at_idx" ON "returns"("created_at" DESC);

-- CreateIndex
CREATE INDEX "return_items_return_id_idx" ON "return_items"("return_id");

-- CreateIndex
CREATE INDEX "return_items_order_item_id_idx" ON "return_items"("order_item_id");

-- CreateIndex
CREATE INDEX "return_items_qc_outcome_idx" ON "return_items"("qc_outcome");

-- CreateIndex
CREATE INDEX "return_evidence_return_id_idx" ON "return_evidence"("return_id");

-- CreateIndex
CREATE INDEX "return_evidence_return_item_id_idx" ON "return_evidence"("return_item_id");

-- CreateIndex
CREATE INDEX "return_status_history_return_id_idx" ON "return_status_history"("return_id");

-- CreateIndex
CREATE INDEX "refund_transactions_return_id_idx" ON "refund_transactions"("return_id");

-- CreateIndex
CREATE INDEX "refund_transactions_status_idx" ON "refund_transactions"("status");

-- CreateIndex
CREATE INDEX "refund_transactions_created_at_idx" ON "refund_transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refund_transactions_return_id_attempt_number_key" ON "refund_transactions"("return_id", "attempt_number");

-- CreateIndex
CREATE INDEX "return_tax_reversal_lines_return_id_idx" ON "return_tax_reversal_lines"("return_id");

-- CreateIndex
CREATE INDEX "return_tax_reversal_lines_return_item_id_idx" ON "return_tax_reversal_lines"("return_item_id");

-- CreateIndex
CREATE INDEX "return_tax_reversal_lines_order_item_id_idx" ON "return_tax_reversal_lines"("order_item_id");

-- CreateIndex
CREATE INDEX "risk_scores_resource_type_score_idx" ON "risk_scores"("resource_type", "score");

-- CreateIndex
CREATE INDEX "risk_scores_tier_idx" ON "risk_scores"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "risk_scores_resource_type_resource_id_key" ON "risk_scores"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "seller_product_mappings_seller_id_idx" ON "seller_product_mappings"("seller_id");

-- CreateIndex
CREATE INDEX "seller_product_mappings_product_id_idx" ON "seller_product_mappings"("product_id");

-- CreateIndex
CREATE INDEX "seller_product_mappings_variant_id_idx" ON "seller_product_mappings"("variant_id");

-- CreateIndex
CREATE INDEX "seller_product_mappings_pickup_pincode_idx" ON "seller_product_mappings"("pickup_pincode");

-- CreateIndex
CREATE INDEX "seller_product_mappings_is_active_idx" ON "seller_product_mappings"("is_active");

-- CreateIndex
CREATE INDEX "seller_product_mappings_approval_status_idx" ON "seller_product_mappings"("approval_status");

-- CreateIndex
CREATE INDEX "seller_product_mappings_deleted_at_idx" ON "seller_product_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "seller_product_mappings_seller_id_approval_status_is_active_idx" ON "seller_product_mappings"("seller_id", "approval_status", "is_active");

-- CreateIndex
CREATE INDEX "seller_product_mappings_product_id_variant_id_deleted_at_idx" ON "seller_product_mappings"("product_id", "variant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "seller_product_mappings_migrated_from_mapping_id_idx" ON "seller_product_mappings"("migrated_from_mapping_id");

-- CreateIndex
CREATE INDEX "seller_product_mappings_product_id_is_active_approval_statu_idx" ON "seller_product_mappings"("product_id", "is_active", "approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_product_mappings_seller_id_product_id_variant_id_key" ON "seller_product_mappings"("seller_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_movements_mapping_id_created_at_idx" ON "stock_movements"("mapping_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE INDEX "stock_movements_resource_type_resource_id_created_at_idx" ON "stock_movements"("resource_type", "resource_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "seller_reversals_idempotency_key_key" ON "seller_reversals"("idempotency_key");

-- CreateIndex
CREATE INDEX "seller_reversals_seller_id_status_requested_at_idx" ON "seller_reversals"("seller_id", "status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "seller_reversals_status_requested_at_idx" ON "seller_reversals"("status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "seller_reversals_sub_order_id_idx" ON "seller_reversals"("sub_order_id");

-- CreateIndex
CREATE INDEX "seller_reversal_items_reversal_id_idx" ON "seller_reversal_items"("reversal_id");

-- CreateIndex
CREATE INDEX "seller_reversal_items_order_item_id_idx" ON "seller_reversal_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_key" ON "sellers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_phone_number_key" ON "sellers"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_gstin_key" ON "sellers"("gstin");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_pan_number_key" ON "sellers"("pan_number");

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");

-- CreateIndex
CREATE INDEX "sellers_is_profile_completed_idx" ON "sellers"("is_profile_completed");

-- CreateIndex
CREATE INDEX "sellers_is_deleted_idx" ON "sellers"("is_deleted");

-- CreateIndex
CREATE INDEX "sellers_verification_status_idx" ON "sellers"("verification_status");

-- CreateIndex
CREATE INDEX "sellers_seller_type_idx" ON "sellers"("seller_type");

-- CreateIndex
CREATE INDEX "sellers_is_194o_exempt_exempt_194o_effective_to_idx" ON "sellers"("is_194o_exempt", "exempt_194o_effective_to");

-- CreateIndex
CREATE INDEX "sellers_fulfillment_hold_idx" ON "sellers"("fulfillment_hold");

-- CreateIndex
CREATE INDEX "seller_tds_exemption_history_seller_id_created_at_idx" ON "seller_tds_exemption_history"("seller_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "seller_sessions_seller_id_idx" ON "seller_sessions"("seller_id");

-- CreateIndex
CREATE INDEX "seller_sessions_refresh_token_hash_idx" ON "seller_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "seller_sessions_previous_refresh_token_hash_idx" ON "seller_sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "seller_sessions_seller_id_revoked_at_idx" ON "seller_sessions"("seller_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "seller_password_reset_otps_reset_token_key" ON "seller_password_reset_otps"("reset_token");

-- CreateIndex
CREATE INDEX "seller_password_reset_otps_seller_id_idx" ON "seller_password_reset_otps"("seller_id");

-- CreateIndex
CREATE INDEX "seller_password_reset_otps_seller_id_purpose_idx" ON "seller_password_reset_otps"("seller_id", "purpose");

-- CreateIndex
CREATE INDEX "seller_password_reset_otps_expires_at_idx" ON "seller_password_reset_otps"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "seller_bank_details_seller_id_key" ON "seller_bank_details"("seller_id");

-- CreateIndex
CREATE INDEX "seller_partner_registrations_seller_id_idx" ON "seller_partner_registrations"("seller_id");

-- CreateIndex
CREATE INDEX "seller_partner_registrations_partner_status_idx" ON "seller_partner_registrations"("partner", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_partner_registrations_seller_id_partner_key" ON "seller_partner_registrations"("seller_id", "partner");

-- CreateIndex
CREATE INDEX "seller_service_areas_seller_id_idx" ON "seller_service_areas"("seller_id");

-- CreateIndex
CREATE INDEX "seller_service_areas_pincode_idx" ON "seller_service_areas"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "seller_service_areas_seller_id_pincode_key" ON "seller_service_areas"("seller_id", "pincode");

-- CreateIndex
CREATE INDEX "stock_reservations_mapping_id_idx" ON "stock_reservations"("mapping_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_idx" ON "stock_reservations"("status");

-- CreateIndex
CREATE INDEX "stock_reservations_expires_at_idx" ON "stock_reservations"("expires_at");

-- CreateIndex
CREATE INDEX "stock_reservations_customer_id_idx" ON "stock_reservations"("customer_id");

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

-- CreateIndex
CREATE INDEX "allocation_logs_product_id_idx" ON "allocation_logs"("product_id");

-- CreateIndex
CREATE INDEX "allocation_logs_allocated_seller_id_idx" ON "allocation_logs"("allocated_seller_id");

-- CreateIndex
CREATE INDEX "allocation_logs_allocated_franchise_id_idx" ON "allocation_logs"("allocated_franchise_id");

-- CreateIndex
CREATE INDEX "allocation_logs_order_id_idx" ON "allocation_logs"("order_id");

-- CreateIndex
CREATE INDEX "allocation_logs_created_at_idx" ON "allocation_logs"("created_at");

-- CreateIndex
CREATE INDEX "allocation_logs_outcome_created_at_idx" ON "allocation_logs"("outcome", "created_at");

-- CreateIndex
CREATE INDEX "allocation_logs_event_source_created_at_idx" ON "allocation_logs"("event_source", "created_at");

-- CreateIndex
CREATE INDEX "allocation_logs_allocated_node_type_idx" ON "allocation_logs"("allocated_node_type");

-- CreateIndex
CREATE INDEX "allocation_logs_is_reallocated_idx" ON "allocation_logs"("is_reallocated");

-- CreateIndex
CREATE INDEX "allocation_candidates_allocation_log_id_idx" ON "allocation_candidates"("allocation_log_id");

-- CreateIndex
CREATE INDEX "allocation_candidates_seller_id_idx" ON "allocation_candidates"("seller_id");

-- CreateIndex
CREATE INDEX "allocation_candidates_franchise_id_idx" ON "allocation_candidates"("franchise_id");

-- CreateIndex
CREATE INDEX "settlement_cycles_status_idx" ON "settlement_cycles"("status");

-- CreateIndex
CREATE INDEX "settlement_cycles_period_start_period_end_idx" ON "settlement_cycles"("period_start", "period_end");

-- CreateIndex
CREATE INDEX "seller_settlements_cycle_id_idx" ON "seller_settlements"("cycle_id");

-- CreateIndex
CREATE INDEX "seller_settlements_seller_id_idx" ON "seller_settlements"("seller_id");

-- CreateIndex
CREATE INDEX "seller_settlements_status_idx" ON "seller_settlements"("status");

-- CreateIndex
CREATE INDEX "seller_settlements_payout_batch_id_idx" ON "seller_settlements"("payout_batch_id");

-- CreateIndex
CREATE INDEX "seller_settlements_status_payout_due_by_idx" ON "seller_settlements"("status", "payout_due_by");

-- CreateIndex
CREATE INDEX "seller_settlements_cycle_id_status_idx" ON "seller_settlements"("cycle_id", "status");

-- CreateIndex
CREATE INDEX "seller_settlements_commission_invoice_filing_period_idx" ON "seller_settlements"("commission_invoice_filing_period");

-- CreateIndex
CREATE UNIQUE INDEX "seller_settlements_cycle_id_seller_id_key" ON "seller_settlements"("cycle_id", "seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_settlement_utr_unique" ON "seller_settlements"("utr_reference");

-- CreateIndex
CREATE INDEX "settlement_adjustments_settlement_id_idx" ON "settlement_adjustments"("settlement_id");

-- CreateIndex
CREATE INDEX "settlement_adjustments_settlement_id_created_at_idx" ON "settlement_adjustments"("settlement_id", "created_at");

-- CreateIndex
CREATE INDEX "settlement_adjustments_adjustment_type_idx" ON "settlement_adjustments"("adjustment_type");

-- CreateIndex
CREATE INDEX "settlement_adjustments_status_idx" ON "settlement_adjustments"("status");

-- CreateIndex
CREATE INDEX "settlement_charge_rules_status_effective_from_idx" ON "settlement_charge_rules"("status", "effective_from");

-- CreateIndex
CREATE INDEX "settlement_charge_rules_base_rule_id_idx" ON "settlement_charge_rules"("base_rule_id");

-- CreateIndex
CREATE INDEX "settlement_charge_lines_settlement_id_idx" ON "settlement_charge_lines"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_options_name_key" ON "shipping_options"("name");

-- CreateIndex
CREATE INDEX "shipping_options_is_active_sort_order_idx" ON "shipping_options"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "shipping_options_seller_id_is_active_idx" ON "shipping_options"("seller_id", "is_active");

-- CreateIndex
CREATE INDEX "shipping_options_active_from_active_until_idx" ON "shipping_options"("active_from", "active_until");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zones_name_key" ON "shipping_zones"("name");

-- CreateIndex
CREATE INDEX "shipping_zones_is_active_priority_idx" ON "shipping_zones"("is_active", "priority");

-- CreateIndex
CREATE INDEX "shipping_rates_option_id_zone_id_is_active_idx" ON "shipping_rates"("option_id", "zone_id", "is_active");

-- CreateIndex
CREATE INDEX "shipping_rates_zone_id_idx" ON "shipping_rates"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_surcharges_name_key" ON "shipping_surcharges"("name");

-- CreateIndex
CREATE INDEX "shipping_surcharges_kind_is_active_stacking_order_idx" ON "shipping_surcharges"("kind", "is_active", "stacking_order");

-- CreateIndex
CREATE INDEX "shipping_surcharges_zone_id_idx" ON "shipping_surcharges"("zone_id");

-- CreateIndex
CREATE INDEX "shipping_surcharges_option_id_idx" ON "shipping_surcharges"("option_id");

-- CreateIndex
CREATE INDEX "shipping_quote_audits_cart_id_computed_at_idx" ON "shipping_quote_audits"("cart_id", "computed_at");

-- CreateIndex
CREATE INDEX "shipping_quote_audits_master_order_id_idx" ON "shipping_quote_audits"("master_order_id");

-- CreateIndex
CREATE INDEX "shipping_quote_audits_selected_option_id_computed_at_idx" ON "shipping_quote_audits"("selected_option_id", "computed_at");

-- CreateIndex
CREATE INDEX "webhook_events_awb_received_at_idx" ON "webhook_events"("awb", "received_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_sub_order_id_idx" ON "webhook_events"("sub_order_id");

-- CreateIndex
CREATE INDEX "webhook_events_process_outcome_received_at_idx" ON "webhook_events"("process_outcome", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_key_key" ON "webhook_events"("provider", "event_key");

-- CreateIndex
CREATE INDEX "shipment_tracking_events_sub_order_id_scan_at_idx" ON "shipment_tracking_events"("sub_order_id", "scan_at" DESC);

-- CreateIndex
CREATE INDEX "shipment_tracking_events_internal_status_scan_at_idx" ON "shipment_tracking_events"("internal_status", "scan_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_tracking_events_sub_order_id_external_status_scan__key" ON "shipment_tracking_events"("sub_order_id", "external_status", "scan_at");

-- CreateIndex
CREATE UNIQUE INDEX "ndr_attempts_carrier_event_id_key" ON "ndr_attempts"("carrier_event_id");

-- CreateIndex
CREATE INDEX "ndr_attempts_sub_order_id_attempted_at_idx" ON "ndr_attempts"("sub_order_id", "attempted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ndr_attempts_sub_order_id_attempt_number_key" ON "ndr_attempts"("sub_order_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "rto_events_carrier_event_id_key" ON "rto_events"("carrier_event_id");

-- CreateIndex
CREATE INDEX "rto_events_sub_order_id_occurred_at_idx" ON "rto_events"("sub_order_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "rto_credit_note_pending_sub_order_id_key" ON "rto_credit_note_pending"("sub_order_id");

-- CreateIndex
CREATE INDEX "rto_credit_note_pending_status_created_at_idx" ON "rto_credit_note_pending"("status", "created_at");

-- CreateIndex
CREATE INDEX "sla_policies_resource_type_status_enabled_idx" ON "sla_policies"("resource_type", "status", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_resource_type_status_name_key" ON "sla_policies"("resource_type", "status", "name");

-- CreateIndex
CREATE INDEX "sla_breaches_resource_type_resource_id_idx" ON "sla_breaches"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "sla_breaches_resolved_at_idx" ON "sla_breaches"("resolved_at");

-- CreateIndex
CREATE INDEX "sla_breaches_breached_at_idx" ON "sla_breaches"("breached_at");

-- CreateIndex
CREATE UNIQUE INDEX "sla_breaches_policy_id_resource_type_resource_id_key" ON "sla_breaches"("policy_id", "resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_menus_handle_key" ON "storefront_menus"("handle");

-- CreateIndex
CREATE INDEX "storefront_menu_items_menu_id_parent_id_position_idx" ON "storefront_menu_items"("menu_id", "parent_id", "position");

-- CreateIndex
CREATE INDEX "storefront_menu_items_menu_id_idx" ON "storefront_menu_items"("menu_id");

-- CreateIndex
CREATE INDEX "storefront_menu_items_menu_id_is_active_parent_id_position_idx" ON "storefront_menu_items"("menu_id", "is_active", "parent_id", "position");

-- CreateIndex
CREATE INDEX "menu_audit_logs_resource_type_resource_id_created_at_idx" ON "menu_audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "menu_audit_logs_actor_id_created_at_idx" ON "menu_audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_name_key" ON "ticket_categories"("name");

-- CreateIndex
CREATE INDEX "ticket_categories_scopedTo_sortOrder_idx" ON "ticket_categories"("scopedTo", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "tickets"("ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_promoted_to_dispute_id_key" ON "tickets"("promoted_to_dispute_id");

-- CreateIndex
CREATE INDEX "tickets_creator_type_creator_id_last_message_at_idx" ON "tickets"("creator_type", "creator_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_status_last_message_at_idx" ON "tickets"("status", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_priority_last_message_at_idx" ON "tickets"("priority", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_assigned_admin_id_status_idx" ON "tickets"("assigned_admin_id", "status");

-- CreateIndex
CREATE INDEX "tickets_related_order_id_idx" ON "tickets"("related_order_id");

-- CreateIndex
CREATE INDEX "tickets_related_return_id_idx" ON "tickets"("related_return_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_messages_mirrored_from_dispute_message_id_key" ON "ticket_messages"("mirrored_from_dispute_message_id");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "tax_document_download_audits_tax_document_id_created_at_idx" ON "tax_document_download_audits"("tax_document_id", "created_at");

-- CreateIndex
CREATE INDEX "tax_document_download_audits_actor_type_actor_id_created_at_idx" ON "tax_document_download_audits"("actor_type", "actor_id", "created_at");

-- CreateIndex
CREATE INDEX "tax_documents_master_order_id_idx" ON "tax_documents"("master_order_id");

-- CreateIndex
CREATE INDEX "tax_documents_sub_order_id_idx" ON "tax_documents"("sub_order_id");

-- CreateIndex
CREATE INDEX "tax_documents_pos_sale_id_idx" ON "tax_documents"("pos_sale_id");

-- CreateIndex
CREATE INDEX "tax_documents_seller_id_idx" ON "tax_documents"("seller_id");

-- CreateIndex
CREATE INDEX "tax_documents_franchise_id_idx" ON "tax_documents"("franchise_id");

-- CreateIndex
CREATE INDEX "tax_documents_customer_id_idx" ON "tax_documents"("customer_id");

-- CreateIndex
CREATE INDEX "tax_documents_platform_gst_profile_id_idx" ON "tax_documents"("platform_gst_profile_id");

-- CreateIndex
CREATE INDEX "tax_documents_customer_tax_profile_id_idx" ON "tax_documents"("customer_tax_profile_id");

-- CreateIndex
CREATE INDEX "tax_documents_document_type_idx" ON "tax_documents"("document_type");

-- CreateIndex
CREATE INDEX "tax_documents_status_idx" ON "tax_documents"("status");

-- CreateIndex
CREATE INDEX "tax_documents_financial_year_idx" ON "tax_documents"("financial_year");

-- CreateIndex
CREATE INDEX "tax_documents_generated_at_idx" ON "tax_documents"("generated_at");

-- CreateIndex
CREATE INDEX "tax_documents_buyer_gstin_idx" ON "tax_documents"("buyer_gstin");

-- CreateIndex
CREATE INDEX "tax_documents_irn_idx" ON "tax_documents"("irn");

-- CreateIndex
CREATE INDEX "tax_documents_einvoice_status_einvoice_last_attempted_at_idx" ON "tax_documents"("einvoice_status", "einvoice_last_attempted_at");

-- CreateIndex
CREATE INDEX "tax_documents_original_document_id_status_idx" ON "tax_documents"("original_document_id", "status");

-- CreateIndex
CREATE INDEX "tax_documents_return_id_idx" ON "tax_documents"("return_id");

-- CreateIndex
CREATE INDEX "tax_documents_einvoice_status_einvoice_retry_count_idx" ON "tax_documents"("einvoice_status", "einvoice_retry_count");

-- CreateIndex
CREATE INDEX "tax_documents_status_pdf_retry_count_idx" ON "tax_documents"("status", "pdf_retry_count");

-- CreateIndex
CREATE INDEX "tax_documents_signed_document_json_retention_until_idx" ON "tax_documents"("signed_document_json_retention_until");

-- CreateIndex
CREATE UNIQUE INDEX "tax_documents_supplier_fy_type_num_uniq" ON "tax_documents"("supplier_gstin", "financial_year", "document_type", "document_number");

-- CreateIndex
CREATE INDEX "einvoice_audit_logs_tax_document_id_created_at_idx" ON "einvoice_audit_logs"("tax_document_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "einvoice_audit_logs_action_created_at_idx" ON "einvoice_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "einvoice_audit_logs_actor_id_created_at_idx" ON "einvoice_audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "tax_document_lines_document_id_idx" ON "tax_document_lines"("document_id");

-- CreateIndex
CREATE INDEX "tax_document_lines_source_snapshot_id_idx" ON "tax_document_lines"("source_snapshot_id");

-- CreateIndex
CREATE INDEX "tax_document_lines_line_type_idx" ON "tax_document_lines"("line_type");

-- CreateIndex
CREATE UNIQUE INDEX "tax_document_lines_doc_line_num_uniq" ON "tax_document_lines"("document_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_sequence_key_key" ON "document_sequences"("sequence_key");

-- CreateIndex
CREATE INDEX "document_sequences_supplier_gstin_financial_year_document_t_idx" ON "document_sequences"("supplier_gstin", "financial_year", "document_type");

-- CreateIndex
CREATE INDEX "tax_readiness_snapshots_generated_at_idx" ON "tax_readiness_snapshots"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "india_states_gst_state_code_key" ON "india_states"("gst_state_code");

-- CreateIndex
CREATE UNIQUE INDEX "uqc_master_code_key" ON "uqc_master"("code");

-- CreateIndex
CREATE INDEX "uqc_master_history_uqc_id_created_at_idx" ON "uqc_master_history"("uqc_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "uqc_master_history_code_created_at_idx" ON "uqc_master_history"("code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "hsn_master_hsn_code_idx" ON "hsn_master"("hsn_code");

-- CreateIndex
CREATE INDEX "hsn_master_is_active_effective_from_idx" ON "hsn_master"("is_active", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "hsn_master_code_effective_uniq" ON "hsn_master"("hsn_code", "effective_from");

-- CreateIndex
CREATE INDEX "hsn_master_history_hsn_master_id_created_at_idx" ON "hsn_master_history"("hsn_master_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "hsn_master_history_hsn_code_created_at_idx" ON "hsn_master_history"("hsn_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "seller_gstins_seller_id_is_active_idx" ON "seller_gstins"("seller_id", "is_active");

-- CreateIndex
CREATE INDEX "seller_gstins_state_code_idx" ON "seller_gstins"("state_code");

-- CreateIndex
CREATE INDEX "seller_gstins_registration_type_idx" ON "seller_gstins"("registration_type");

-- CreateIndex
CREATE INDEX "seller_gstins_is_verified_idx" ON "seller_gstins"("is_verified");

-- CreateIndex
CREATE INDEX "seller_gstins_legal_name_mismatch_idx" ON "seller_gstins"("legal_name_mismatch");

-- CreateIndex
CREATE UNIQUE INDEX "seller_gstins_seller_gstin_uniq" ON "seller_gstins"("seller_id", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "seller_gstins_gstin_global_uniq" ON "seller_gstins"("gstin");

-- CreateIndex
CREATE INDEX "customer_tax_profiles_customer_id_is_default_idx" ON "customer_tax_profiles"("customer_id", "is_default");

-- CreateIndex
CREATE INDEX "customer_tax_profiles_gstin_idx" ON "customer_tax_profiles"("gstin");

-- CreateIndex
CREATE INDEX "customer_tax_profiles_legal_name_mismatch_idx" ON "customer_tax_profiles"("legal_name_mismatch");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tax_profiles_user_gstin_uniq" ON "customer_tax_profiles"("customer_id", "gstin");

-- CreateIndex
CREATE INDEX "customer_tax_profile_history_profile_id_created_at_idx" ON "customer_tax_profile_history"("profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "customer_tax_profile_history_customer_id_created_at_idx" ON "customer_tax_profile_history"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "gstin_verification_events_target_type_target_id_created_at_idx" ON "gstin_verification_events"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "gstin_verification_events_gstin_created_at_idx" ON "gstin_verification_events"("gstin", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "platform_gst_profiles_gstin_key" ON "platform_gst_profiles"("gstin");

-- CreateIndex
CREATE INDEX "platform_gst_profiles_is_default_is_active_idx" ON "platform_gst_profiles"("is_default", "is_active");

-- CreateIndex
CREATE INDEX "platform_gst_profiles_gst_state_code_idx" ON "platform_gst_profiles"("gst_state_code");

-- CreateIndex
CREATE INDEX "platform_gst_profile_history_profile_id_created_at_idx" ON "platform_gst_profile_history"("profile_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tax_config_key_key" ON "tax_config"("key");

-- CreateIndex
CREATE INDEX "gst_mode_history_created_at_idx" ON "gst_mode_history"("created_at");

-- CreateIndex
CREATE INDEX "wallet_refund_sagas_status_last_attempt_at_idx" ON "wallet_refund_sagas"("status", "last_attempt_at");

-- CreateIndex
CREATE INDEX "wallet_refund_sagas_order_id_idx" ON "wallet_refund_sagas"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "wallet_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_status_created_at_idx" ON "wallet_transactions"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_reference_type_reference_id_type_key" ON "wallet_transactions"("reference_type", "reference_id", "type");

-- CreateIndex
CREATE INDEX "loyalty_earn_events_user_id_created_at_idx" ON "loyalty_earn_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_earn_events_status_idx" ON "loyalty_earn_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_earn_events_source_type_source_id_key" ON "loyalty_earn_events"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_adjustments_idempotency_key_key" ON "wallet_adjustments"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_adjustments_customer_id_idx" ON "wallet_adjustments"("customer_id");

-- CreateIndex
CREATE INDEX "wallet_adjustments_wallet_id_idx" ON "wallet_adjustments"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_adjustments_status_idx" ON "wallet_adjustments"("status");

-- CreateIndex
CREATE INDEX "wallet_adjustments_return_id_idx" ON "wallet_adjustments"("return_id");

-- CreateIndex
CREATE INDEX "wallet_adjustments_source_tax_document_id_idx" ON "wallet_adjustments"("source_tax_document_id");

-- CreateIndex
CREATE INDEX "wallet_adjustment_history_adjustment_id_created_at_idx" ON "wallet_adjustment_history"("adjustment_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_adjustment_history_customer_id_created_at_idx" ON "wallet_adjustment_history"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_endpoints_status_environment_idx" ON "webhook_endpoints"("status", "environment");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_name_dedupe_key_key" ON "webhook_deliveries"("endpoint_id", "event_name", "dedupe_key");

-- CreateIndex
CREATE INDEX "wishlist_items_user_id_created_at_idx" ON "wishlist_items"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_product_id_variant_id_key" ON "wishlist_items"("user_id", "product_id", "variant_id");

-- AddForeignKey
ALTER TABLE "admin_password_reset_otps" ADD CONSTRAINT "admin_password_reset_otps_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_action_audit_logs" ADD CONSTRAINT "admin_action_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_impersonation_logs" ADD CONSTRAINT "admin_impersonation_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_seller_messages" ADD CONSTRAINT "admin_seller_messages_sent_by_admin_id_fkey" FOREIGN KEY ("sent_by_admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_custom_role_permissions" ADD CONSTRAINT "admin_custom_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_status_history" ADD CONSTRAINT "affiliate_status_history_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commission_rate_history" ADD CONSTRAINT "affiliate_commission_rate_history_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_sessions" ADD CONSTRAINT "affiliate_sessions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_password_reset_otps" ADD CONSTRAINT "affiliate_password_reset_otps_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_coupon_codes" ADD CONSTRAINT "affiliate_coupon_codes_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_coupon_code_id_fkey" FOREIGN KEY ("coupon_code_id") REFERENCES "affiliate_coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "affiliate_payout_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_referral_attribution_id_fkey" FOREIGN KEY ("referral_attribution_id") REFERENCES "referral_attributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_coupon_code_id_fkey" FOREIGN KEY ("coupon_code_id") REFERENCES "affiliate_coupon_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "affiliate_payout_request_status_history" ADD CONSTRAINT "affiliate_payout_request_status_history_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "affiliate_payout_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_tds_records" ADD CONSTRAINT "affiliate_tds_records_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_tds_194o_ledger" ADD CONSTRAINT "affiliate_tds_194o_ledger_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_tds_194o_ledger" ADD CONSTRAINT "affiliate_tds_194o_ledger_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "affiliate_payout_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_chain_verification_issues" ADD CONSTRAINT "audit_chain_verification_issues_verification_run_id_fkey" FOREIGN KEY ("verification_run_id") REFERENCES "audit_chain_verification_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_audit_logs" ADD CONSTRAINT "category_audit_logs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_audit_logs" ADD CONSTRAINT "brand_audit_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_option_definition_id_fkey" FOREIGN KEY ("option_definition_id") REFERENCES "option_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_option_templates" ADD CONSTRAINT "category_option_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_option_templates" ADD CONSTRAINT "category_option_templates_option_definition_id_fkey" FOREIGN KEY ("option_definition_id") REFERENCES "option_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_attestation_logs" ADD CONSTRAINT "tax_attestation_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_option_definition_id_fkey" FOREIGN KEY ("option_definition_id") REFERENCES "option_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_images" ADD CONSTRAINT "product_variant_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_seo" ADD CONSTRAINT "product_seo_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collection_maps" ADD CONSTRAINT "product_collection_maps_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collection_maps" ADD CONSTRAINT "product_collection_maps_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_audit_logs" ADD CONSTRAINT "collection_audit_logs_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_status_history" ADD CONSTRAINT "product_status_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metafield_definitions" ADD CONSTRAINT "metafield_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metafield_definition_audit_logs" ADD CONSTRAINT "metafield_definition_audit_logs_metafield_definition_id_fkey" FOREIGN KEY ("metafield_definition_id") REFERENCES "metafield_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_metafields" ADD CONSTRAINT "product_metafields_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_metafields" ADD CONSTRAINT "product_metafields_metafield_definition_id_fkey" FOREIGN KEY ("metafield_definition_id") REFERENCES "metafield_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_filters" ADD CONSTRAINT "storefront_filters_metafield_definition_id_fkey" FOREIGN KEY ("metafield_definition_id") REFERENCES "metafield_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_response_imports" ADD CONSTRAINT "bank_response_imports_payout_batch_id_fkey" FOREIGN KEY ("payout_batch_id") REFERENCES "payout_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_response_rows" ADD CONSTRAINT "bank_response_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bank_response_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "seller_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_adjusted_by_fkey" FOREIGN KEY ("adjusted_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_reversal_records" ADD CONSTRAINT "commission_reversal_records_commission_record_id_fkey" FOREIGN KEY ("commission_record_id") REFERENCES "commission_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_hold_history" ADD CONSTRAINT "commission_hold_history_commission_record_id_fkey" FOREIGN KEY ("commission_record_id") REFERENCES "commission_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_adjustment_history" ADD CONSTRAINT "commission_adjustment_history_commission_record_id_fkey" FOREIGN KEY ("commission_record_id") REFERENCES "commission_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_collections" ADD CONSTRAINT "discount_collections_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_collections" ADD CONSTRAINT "discount_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_discounts" ADD CONSTRAINT "order_item_discounts_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_discounts" ADD CONSTRAINT "order_item_discounts_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_discounts" ADD CONSTRAINT "order_item_discounts_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_discounts" ADD CONSTRAINT "order_item_discounts_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_liability_ledger" ADD CONSTRAINT "discount_liability_ledger_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_liability_ledger" ADD CONSTRAINT "discount_liability_ledger_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_eligibility_rules" ADD CONSTRAINT "discount_eligibility_rules_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_way_bills" ADD CONSTRAINT "e_way_bills_replaced_eway_bill_id_fkey" FOREIGN KEY ("replaced_eway_bill_id") REFERENCES "e_way_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_way_bills" ADD CONSTRAINT "e_way_bills_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_way_bills" ADD CONSTRAINT "e_way_bills_tax_document_id_fkey" FOREIGN KEY ("tax_document_id") REFERENCES "tax_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_way_bill_audit_logs" ADD CONSTRAINT "e_way_bill_audit_logs_eway_bill_id_fkey" FOREIGN KEY ("eway_bill_id") REFERENCES "e_way_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_evidence" ADD CONSTRAINT "shipment_evidence_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_evidence" ADD CONSTRAINT "shipment_evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_evidence_audits" ADD CONSTRAINT "shipment_evidence_audits_shipment_evidence_id_fkey" FOREIGN KEY ("shipment_evidence_id") REFERENCES "shipment_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_reversal_items" ADD CONSTRAINT "franchise_reversal_items_reversal_id_fkey" FOREIGN KEY ("reversal_id") REFERENCES "franchise_reversals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_partner_registrations" ADD CONSTRAINT "franchise_partner_registrations_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_status_history" ADD CONSTRAINT "franchise_status_history_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_verification_events" ADD CONSTRAINT "franchise_verification_events_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_procurement_prices" ADD CONSTRAINT "franchise_procurement_prices_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_procurement_price_history" ADD CONSTRAINT "franchise_procurement_price_history_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pincode_mappings" ADD CONSTRAINT "franchise_pincode_mappings_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pincode_mapping_events" ADD CONSTRAINT "franchise_pincode_mapping_events_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_sessions" ADD CONSTRAINT "franchise_sessions_franchise_partner_id_fkey" FOREIGN KEY ("franchise_partner_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_bank_details" ADD CONSTRAINT "franchise_bank_details_franchise_partner_id_fkey" FOREIGN KEY ("franchise_partner_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_password_reset_otps" ADD CONSTRAINT "franchise_password_reset_otps_franchise_partner_id_fkey" FOREIGN KEY ("franchise_partner_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mappings" ADD CONSTRAINT "franchise_catalog_mappings_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mappings" ADD CONSTRAINT "franchise_catalog_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mappings" ADD CONSTRAINT "franchise_catalog_mappings_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_catalog_mapping_events" ADD CONSTRAINT "franchise_catalog_mapping_events_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_stock" ADD CONSTRAINT "franchise_stock_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_inventory_ledger" ADD CONSTRAINT "franchise_inventory_ledger_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_request_events" ADD CONSTRAINT "procurement_request_events_procurement_request_id_fkey" FOREIGN KEY ("procurement_request_id") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_request_items" ADD CONSTRAINT "procurement_request_items_procurement_request_id_fkey" FOREIGN KEY ("procurement_request_id") REFERENCES "procurement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pos_sales" ADD CONSTRAINT "franchise_pos_sales_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pos_returns" ADD CONSTRAINT "franchise_pos_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "franchise_pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pos_return_items" ADD CONSTRAINT "franchise_pos_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "franchise_pos_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_pos_sale_items" ADD CONSTRAINT "franchise_pos_sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "franchise_pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_finance_ledger" ADD CONSTRAINT "franchise_finance_ledger_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_finance_ledger" ADD CONSTRAINT "franchise_finance_ledger_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "franchise_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_ledger_status_history" ADD CONSTRAINT "franchise_ledger_status_history_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "franchise_finance_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_penalty_approvals" ADD CONSTRAINT "franchise_penalty_approvals_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "settlement_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_paid_by_admin_id_fkey" FOREIGN KEY ("paid_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_tcs_ledger_id_fkey" FOREIGN KEY ("tcs_ledger_id") REFERENCES "gst_tcs_settlement_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlements" ADD CONSTRAINT "franchise_settlements_tds_ledger_id_fkey" FOREIGN KEY ("tds_ledger_id") REFERENCES "section_194o_tds_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlement_charge_lines" ADD CONSTRAINT "franchise_settlement_charge_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "franchise_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_settlement_adjustments" ADD CONSTRAINT "franchise_settlement_adjustments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "franchise_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_staff" ADD CONSTRAINT "franchise_staff_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_staff_sessions" ADD CONSTRAINT "franchise_staff_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "franchise_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_tcs_settlement_ledger" ADD CONSTRAINT "gst_tcs_settlement_ledger_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_tcs_settlement_ledger" ADD CONSTRAINT "gst_tcs_settlement_ledger_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_tcs_ledger_event" ADD CONSTRAINT "gst_tcs_ledger_event_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "gst_tcs_settlement_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_otps" ADD CONSTRAINT "password_reset_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_otps" ADD CONSTRAINT "email_verification_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_194o_tds_ledger" ADD CONSTRAINT "section_194o_tds_ledger_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_194o_tds_ledger" ADD CONSTRAINT "section_194o_tds_ledger_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_template_history" ADD CONSTRAINT "notification_template_history_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_claimed_by_admin_id_fkey" FOREIGN KEY ("claimed_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_shipping_option_id_fkey" FOREIGN KEY ("shipping_option_id") REFERENCES "shipping_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_collections" ADD CONSTRAINT "cash_collections_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_tax_config_snapshots" ADD CONSTRAINT "order_item_tax_config_snapshots_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_verification_decisions" ADD CONSTRAINT "order_verification_decisions_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_claim_history" ADD CONSTRAINT "order_claim_history_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_risk_score_history" ADD CONSTRAINT "order_risk_score_history_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_risk_reasons" ADD CONSTRAINT "order_risk_reasons_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignment_logs" ADD CONSTRAINT "order_reassignment_logs_reassigned_by_fkey" FOREIGN KEY ("reassigned_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignment_logs" ADD CONSTRAINT "order_reassignment_logs_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignment_logs" ADD CONSTRAINT "order_reassignment_logs_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reassignment_logs" ADD CONSTRAINT "order_reassignment_logs_new_sub_order_id_fkey" FOREIGN KEY ("new_sub_order_id") REFERENCES "sub_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_order_awb_history" ADD CONSTRAINT "sub_order_awb_history_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_tax_snapshots" ADD CONSTRAINT "order_item_tax_snapshots_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_brand_stocks" ADD CONSTRAINT "own_brand_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "own_brand_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_brand_procurement_orders" ADD CONSTRAINT "own_brand_procurement_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "own_brand_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_brand_procurement_order_items" ADD CONSTRAINT "own_brand_procurement_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "own_brand_procurement_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancy_status_history" ADD CONSTRAINT "reconciliation_discrepancy_status_history_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "reconciliation_discrepancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_instruction_status_history" ADD CONSTRAINT "refund_instruction_status_history_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "refund_instructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_replacement_order_id_fkey" FOREIGN KEY ("replacement_order_id") REFERENCES "master_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_exchange_order_id_fkey" FOREIGN KEY ("exchange_order_id") REFERENCES "master_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_return_item_id_fkey" FOREIGN KEY ("return_item_id") REFERENCES "return_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_status_history" ADD CONSTRAINT "return_status_history_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_tax_reversal_lines" ADD CONSTRAINT "return_tax_reversal_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_tax_reversal_lines" ADD CONSTRAINT "return_tax_reversal_lines_return_item_id_fkey" FOREIGN KEY ("return_item_id") REFERENCES "return_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_product_mappings" ADD CONSTRAINT "seller_product_mappings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_product_mappings" ADD CONSTRAINT "seller_product_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_product_mappings" ADD CONSTRAINT "seller_product_mappings_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "seller_product_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_reversal_items" ADD CONSTRAINT "seller_reversal_items_reversal_id_fkey" FOREIGN KEY ("reversal_id") REFERENCES "seller_reversals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_sessions" ADD CONSTRAINT "seller_sessions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_password_reset_otps" ADD CONSTRAINT "seller_password_reset_otps_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_details" ADD CONSTRAINT "seller_bank_details_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_partner_registrations" ADD CONSTRAINT "seller_partner_registrations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_service_areas" ADD CONSTRAINT "seller_service_areas_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "seller_product_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_candidates" ADD CONSTRAINT "allocation_candidates_allocation_log_id_fkey" FOREIGN KEY ("allocation_log_id") REFERENCES "allocation_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_cycles" ADD CONSTRAINT "settlement_cycles_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_cycles" ADD CONSTRAINT "settlement_cycles_approved_by_admin_id_fkey" FOREIGN KEY ("approved_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "settlement_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_tcs_ledger_id_fkey" FOREIGN KEY ("tcs_ledger_id") REFERENCES "gst_tcs_settlement_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_tds_ledger_id_fkey" FOREIGN KEY ("tds_ledger_id") REFERENCES "section_194o_tds_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_paid_by_admin_id_fkey" FOREIGN KEY ("paid_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settlements" ADD CONSTRAINT "seller_settlements_payout_batch_id_fkey" FOREIGN KEY ("payout_batch_id") REFERENCES "payout_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "seller_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_voided_by_admin_id_fkey" FOREIGN KEY ("voided_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_charge_lines" ADD CONSTRAINT "settlement_charge_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "seller_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_options" ADD CONSTRAINT "shipping_zone_options_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_options" ADD CONSTRAINT "shipping_zone_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "shipping_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "shipping_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_surcharges" ADD CONSTRAINT "shipping_surcharges_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_surcharges" ADD CONSTRAINT "shipping_surcharges_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "shipping_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_quote_audits" ADD CONSTRAINT "shipping_quote_audits_matched_zone_id_fkey" FOREIGN KEY ("matched_zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ndr_attempts" ADD CONSTRAINT "ndr_attempts_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rto_events" ADD CONSTRAINT "rto_events_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "sla_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_menu_items" ADD CONSTRAINT "storefront_menu_items_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "storefront_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_menu_items" ADD CONSTRAINT "storefront_menu_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "storefront_menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_document_download_audits" ADD CONSTRAINT "tax_document_download_audits_tax_document_id_fkey" FOREIGN KEY ("tax_document_id") REFERENCES "tax_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_platform_gst_profile_id_fkey" FOREIGN KEY ("platform_gst_profile_id") REFERENCES "platform_gst_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_customer_tax_profile_id_fkey" FOREIGN KEY ("customer_tax_profile_id") REFERENCES "customer_tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einvoice_audit_logs" ADD CONSTRAINT "einvoice_audit_logs_tax_document_id_fkey" FOREIGN KEY ("tax_document_id") REFERENCES "tax_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_document_lines" ADD CONSTRAINT "tax_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tax_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uqc_master_history" ADD CONSTRAINT "uqc_master_history_uqc_id_fkey" FOREIGN KEY ("uqc_id") REFERENCES "uqc_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hsn_master_history" ADD CONSTRAINT "hsn_master_history_hsn_master_id_fkey" FOREIGN KEY ("hsn_master_id") REFERENCES "hsn_master"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_gstins" ADD CONSTRAINT "seller_gstins_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tax_profiles" ADD CONSTRAINT "customer_tax_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_gst_profile_history" ADD CONSTRAINT "platform_gst_profile_history_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "platform_gst_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_source_tax_document_id_fkey" FOREIGN KEY ("source_tax_document_id") REFERENCES "tax_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

