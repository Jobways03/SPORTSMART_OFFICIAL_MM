import { apiClient, ApiResponse } from '@/lib/api-client';

export interface ReturnEligibility {
  eligible: boolean;
  reason?: string;
  eligibleSubOrders: Array<{
    subOrderId: string;
    orderNumber: string;
    deliveredAt: string | null;
    returnWindowEndsAt: string | null;
    windowExpired: boolean;
    items: Array<{
      orderItemId: string;
      productTitle: string;
      variantTitle: string | null;
      sku: string | null;
      imageUrl: string | null;
      quantity: number;
      unitPrice: number;
      alreadyReturnedQty: number;
      availableForReturn: number;
      eligible: boolean;
      previouslyRejected?: boolean;
      ineligibleReason?:
        | 'WINDOW_EXPIRED'
        | 'ALREADY_RETURNED'
        | 'PREVIOUSLY_REJECTED';
    }>;
  }>;
}

export interface ReturnItem {
  id: string;
  orderItemId: string;
  quantity: number;
  reasonCategory: string;
  reasonDetail: string | null;
  qcOutcome?: string | null;
  qcQuantityApproved?: number | null;
  qcNotes?: string | null;
  refundAmount?: string | number | null;
  orderItem?: {
    productTitle: string;
    variantTitle: string | null;
    imageUrl: string | null;
    unitPrice: number;
  };
}

export interface ReturnEvidence {
  id: string;
  uploadedBy: string; // 'CUSTOMER' | 'ADMIN' | 'SELLER' | 'FRANCHISE'
  fileUrl: string;
  description: string | null;
  createdAt: string;
}

export interface ReturnDetail {
  id: string;
  returnNumber: string;
  status: string;
  customerNotes: string | null;
  refundAmount: number | null;
  refundMethod: string | null;
  refundReference: string | null;
  refundProcessedAt: string | null;
  rejectionReason: string | null;
  qcNotes?: string | null;
  pickupScheduledAt: string | null;
  pickupCourier: string | null;
  pickupTrackingNumber: string | null;
  receivedAt: string | null;
  qcCompletedAt: string | null;
  qcDecision: string | null;
  closedAt: string | null;
  createdAt: string;
  items: ReturnItem[];
  evidence?: ReturnEvidence[];
  statusHistory?: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    changedBy: string;
    notes: string | null;
    createdAt: string;
  }>;
  subOrder?: {
    fulfillmentNodeType: string;
  };
  masterOrder?: {
    orderNumber: string;
  };
  // Phase 13 (P1.14) — replacement / exchange lifecycle. Drives the
  // "Pay difference for exchange" CTA on this page when the customer
  // picked an EXCHANGE remedy and the target SKU is pricier.
  customerRemedy?:
    | 'FULL_REFUND'
    | 'PARTIAL_REFUND'
    | 'NO_REFUND'
    | 'GOODWILL_CREDIT'
    | 'REPLACEMENT'
    | 'EXCHANGE'
    | null;
  replacementStatus?:
    | 'NONE'
    | 'PENDING_STOCK_CHECK'
    | 'AWAITING_PAYMENT'
    | 'AWAITING_FULFILMENT'
    | 'FULFILLED'
    | 'CANCELLED'
    | 'FALLBACK_TO_REFUND'
    | null;
  exchangePriceDiffPaise?: string | number | null;
  exchangeRazorpayOrderId?: string | null;
  exchangePaymentCompletedAt?: string | null;
  replacementOrderId?: string | null;
  // Phase 38 — refund-settlement story:
  //   creditNote != null  → Section-34 window was open at QC, CN issued
  //   walletCredit != null → Section-34 time-barred, refund routed via wallet
  // Both can be null pre-QC. The UI renders one or the other (or
  // "processing" when neither is present yet but refund is in flight).
  creditNote?: {
    id: string;
    documentNumber: string;
    documentTotalInPaise: string;
    status: string;
    generatedAt: string | null;
  } | null;
  walletCredit?: {
    id: string;
    kind: string;
    status: string;
    amountInPaise: string;
    approvedAt: string | null;
    reason: string;
  } | null;
}

export interface CreateReturnPayload {
  subOrderId: string;
  items: Array<{
    orderItemId: string;
    quantity: number;
    reasonCategory: string;
    reasonDetail?: string;
  }>;
  customerNotes?: string;
  forfeitConsent: boolean;
  evidenceFileUrls: string[];
}

export interface ListReturnsResponse {
  returns: ReturnDetail[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const returnsService = {
  checkEligibility(masterOrderId: string): Promise<ApiResponse<ReturnEligibility>> {
    return apiClient<ReturnEligibility>(`/customer/returns/eligibility/${masterOrderId}`);
  },
  create(payload: CreateReturnPayload): Promise<ApiResponse<ReturnDetail>> {
    return apiClient<ReturnDetail>('/customer/returns', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  list(page: number = 1, limit: number = 20, status?: string): Promise<ApiResponse<ListReturnsResponse>> {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) qs.append('status', status);
    return apiClient<ListReturnsResponse>(`/customer/returns?${qs.toString()}`);
  },
  get(returnId: string): Promise<ApiResponse<ReturnDetail>> {
    return apiClient<ReturnDetail>(`/customer/returns/${returnId}`);
  },
  cancel(returnId: string): Promise<ApiResponse<ReturnDetail>> {
    return apiClient<ReturnDetail>(`/customer/returns/${returnId}/cancel`, { method: 'POST' });
  },
  markHandedOver(returnId: string): Promise<ApiResponse<ReturnDetail>> {
    return apiClient<ReturnDetail>(`/customer/returns/${returnId}/handed-over`, { method: 'POST' });
  },

  /**
   * Phase 13 (P1.14) — initiate Razorpay payment for the exchange
   * price-up diff. Service requires `replacementStatus=AWAITING_PAYMENT`.
   * Response carries the Razorpay order id and amount-in-paise; the
   * caller hands these to Razorpay's web SDK for checkout.
   */
  initiateExchangePayment(
    returnId: string,
  ): Promise<
    ApiResponse<{ razorpayOrderId: string; amountInPaise: number }>
  > {
    return apiClient(`/customer/returns/${returnId}/exchange-payment-init`, {
      method: 'POST',
    });
  },

  /**
   * Phase 13 (P1.14) — verify the Razorpay signature after the SDK
   * completes payment. Service flips status to PENDING_STOCK_CHECK
   * and triggers replacement-order creation; on success the return
   * lands on `AWAITING_FULFILMENT`.
   */
  verifyExchangePayment(
    returnId: string,
    payload: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ): Promise<
    ApiResponse<{ replacementOrderId: string | null; status: string }>
  > {
    return apiClient(`/customer/returns/${returnId}/exchange-payment-verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const REASON_CATEGORIES = [
  { value: 'DEFECTIVE', label: 'Defective Product' },
  { value: 'WRONG_ITEM', label: 'Wrong Item Received' },
  { value: 'NOT_AS_DESCRIBED', label: 'Not As Described' },
  { value: 'DAMAGED_IN_TRANSIT', label: 'Damaged In Transit' },
  { value: 'CHANGED_MIND', label: 'Changed My Mind' },
  { value: 'SIZE_FIT_ISSUE', label: 'Size or Fit Issue' },
  { value: 'QUALITY_ISSUE', label: 'Quality Issue' },
  { value: 'OTHER', label: 'Other' },
];

export function getReturnStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    REQUESTED: 'Pending Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    PICKUP_SCHEDULED: 'Pickup Scheduled',
    IN_TRANSIT: 'In Transit',
    RECEIVED: 'Received at Warehouse',
    QC_APPROVED: 'QC Approved',
    QC_REJECTED: 'QC Failed',
    PARTIALLY_APPROVED: 'Partially Approved',
    REFUND_PROCESSING: 'Processing Refund',
    REFUNDED: 'Refunded',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return labels[status] || status;
}

export function getReturnStatusColor(status: string): string {
  if (['REJECTED', 'QC_REJECTED', 'CANCELLED'].includes(status)) return '#dc2626';
  if (['REFUNDED', 'COMPLETED', 'QC_APPROVED'].includes(status)) return '#16a34a';
  if (['IN_TRANSIT', 'PICKUP_SCHEDULED', 'REFUND_PROCESSING'].includes(status)) return '#2563eb';
  if (['RECEIVED', 'PARTIALLY_APPROVED'].includes(status)) return '#d97706';
  return '#6b7280'; // REQUESTED, APPROVED default
}
