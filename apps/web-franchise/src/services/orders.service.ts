import { apiClient } from '@/lib/api-client';

export interface FranchiseOrderItem {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

export interface FranchiseOrder {
  id: string;
  masterOrderId: string;
  fulfillmentNodeType: string;
  franchiseId: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  acceptDeadlineAt: string | null;
  rejectionReason: string | null;
  rejectionNote: string | null;
  expectedDispatchDate: string | null;
  deliveredAt: string | null;
  returnWindowEndsAt: string | null;
  trackingNumber: string | null;
  courierName: string | null;
  shippingLabelUrl: string | null;
  deliveryMethod: string | null;
  createdAt: string;
  updatedAt: string;
  items?: FranchiseOrderItem[];
  masterOrder?: {
    id: string;
    orderNumber: string;
    customerId: string;
    shippingAddressSnapshot: any;
    totalAmount: number;
    paymentMethod: string;
    // Wallet-aware label from the API ("Paid by Wallet" / "Cash on Delivery
    // (Wallet ₹X applied)" / "Online" …) — prefer this over raw paymentMethod.
    paymentMethodLabel?: string;
    walletAmountUsedInPaise?: string;
    paymentStatus: string;
    orderStatus: string;
    createdAt: string;
  };
}

export interface FranchiseShipmentEvidence {
  id: string;
  kind: string;
  capturedAt: string;
  frozenAt: string | null;
  // Server-derived view URL for PRIVATE (SHIPMENT_EVIDENCE) files.
  viewUrl?: string;
  file: {
    id: string;
    fileName: string;
    providerUrl?: string | null;
    storageKey: string;
  };
}

export const franchiseOrdersService = {
  list(
    params: {
      page?: number;
      limit?: number;
      fulfillmentStatus?: string;
      acceptStatus?: string;
      search?: string;
    } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.fulfillmentStatus) qs.set('fulfillmentStatus', params.fulfillmentStatus);
    if (params.acceptStatus) qs.set('acceptStatus', params.acceptStatus);
    if (params.search) qs.set('search', params.search);
    return apiClient<{
      subOrders: FranchiseOrder[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/franchise/orders?${qs.toString()}`);
  },

  get(subOrderId: string) {
    return apiClient<FranchiseOrder>(`/franchise/orders/${subOrderId}`);
  },

  accept(subOrderId: string, expectedDispatchDate?: string) {
    return apiClient(`/franchise/orders/${subOrderId}/accept`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedDispatchDate }),
    });
  },

  reject(subOrderId: string, reason?: string, note?: string) {
    return apiClient(`/franchise/orders/${subOrderId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason, note }),
    });
  },

  updateStatus(
    subOrderId: string,
    status: 'PACKED' | 'SHIPPED',
    trackingNumber?: string,
    courierName?: string,
  ) {
    return apiClient(`/franchise/orders/${subOrderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, trackingNumber, courierName }),
    });
  },

  /**
   * Phase 92 — franchise self-service Delhivery pickup. Schedules the pickup
   * for this sub-order's warehouse (idempotent per warehouse+day).
   */
  requestPickup(subOrderId: string) {
    return apiClient<{ message?: string; success?: boolean }>(
      `/franchise/sub-orders/${subOrderId}/request-pickup`,
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': `pickup-${subOrderId}-${Date.now()}` },
      },
    );
  },

  /**
   * Phase 92 — franchise self-service shipping label. Fetches the real
   * Delhivery label PDF URL for this sub-order on demand (labelUrl may be null
   * until the shipment is manifested). The franchise packs the box, so it needs
   * the label to print + paste before pickup.
   */
  getShippingLabel(subOrderId: string) {
    return apiClient<{
      labelUrl?: string | null;
      awb?: string | null;
      courierName?: string | null;
    }>(`/franchise/sub-orders/${subOrderId}/label`);
  },

  /**
   * Pre-ship "proof of dispatch" photos for a FRANCHISE-fulfilled sub-order.
   * Mirrors the seller shipment-evidence surface so franchises can satisfy the
   * packing-photo gate before marking a Delhivery order PACKED.
   */
  getShipmentEvidence(subOrderId: string) {
    return apiClient<FranchiseShipmentEvidence[]>(
      `/franchise/sub-orders/${subOrderId}/shipment-evidence`,
    );
  },

  uploadShipmentEvidence(subOrderId: string, file: File) {
    const fd = new FormData();
    fd.append('image', file);
    // apiClient auto-detects FormData and lets the browser set the multipart
    // boundary (no application/json content-type).
    return apiClient<{ success?: boolean; message?: string }>(
      `/franchise/sub-orders/${subOrderId}/shipment-evidence`,
      { method: 'POST', body: fd as unknown as BodyInit },
    );
  },
};
