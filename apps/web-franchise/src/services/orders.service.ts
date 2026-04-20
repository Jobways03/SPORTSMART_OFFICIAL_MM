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
    paymentStatus: string;
    orderStatus: string;
    createdAt: string;
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
};
