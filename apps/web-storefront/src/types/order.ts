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

export interface OrderDetail {
  id: string;
  orderNumber: string;
  orderStatus: string;
  orderStatusLabel: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
  shippingAddressSnapshot: ShippingAddressSnapshot;
  subOrders: SubOrder[];
  // Phase D — discount the customer applied to this order (if any).
  // Legacy orders return null; even pre-Phase-B orders with a non-zero
  // discountAmount land here with code=null.
  appliedDiscount?: {
    code: string | null;
    title: string | null;
    discountAmount: string;
  } | null;
}

export interface ReturnEligibilityItem {
  itemId: string;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface ReturnEligibilitySubOrder {
  subOrderId: string;
  items: ReturnEligibilityItem[];
}

export interface ReturnEligibilityResponse {
  eligibleSubOrders: ReturnEligibilitySubOrder[];
}
