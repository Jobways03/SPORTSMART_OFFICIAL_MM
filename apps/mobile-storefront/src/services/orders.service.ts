import {apiClient, ApiResponse} from '../lib/api-client';

// Mirrors web-storefront's order types from src/types/order.ts. Money fields
// are already in rupees on the wire — formatINR consumes directly.

export interface OrderItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

export interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  deliveredAt: string | null;
  returnWindowEndsAt: string | null;
  fulfilledBy?: string;
  trackingNumber?: string | null;
  courierName?: string | null;
  deliveryMethod?: 'ITHINK_LOGISTICS' | 'SELF_DELIVERY' | null;
  ithinkAwb?: string | null;
  ithinkLogistic?: string | null;
  ithinkTrackingUrl?: string | null;
  items: OrderItem[];
}

export interface ShippingAddressSnapshot {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
  subOrders: SubOrder[];
}

export interface OrderDetail extends OrderListItem {
  orderStatusLabel: string;
  shippingAddressSnapshot: ShippingAddressSnapshot;
  appliedDiscount?: {
    code: string | null;
    title: string | null;
    discountAmount: string;
  } | null;
  shipping?: {
    optionName: string | null;
    feeInPaise: string;
    feeInRupees: string;
  } | null;
}

export interface OrdersListResponse {
  orders: OrderListItem[];
  pagination: {page: number; total: number; totalPages: number};
}

export const ordersService = {
  list(
    page = 1,
    limit = 20,
  ): Promise<ApiResponse<OrdersListResponse>> {
    return apiClient<OrdersListResponse>(
      `/customer/orders?page=${page}&limit=${limit}`,
    );
  },

  get(orderNumber: string): Promise<ApiResponse<OrderDetail>> {
    return apiClient<OrderDetail>(`/customer/orders/${orderNumber}`);
  },

  cancel(orderNumber: string): Promise<ApiResponse<OrderDetail>> {
    return apiClient<OrderDetail>(`/customer/orders/${orderNumber}/cancel`, {
      method: 'PATCH',
    });
  },
};
