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
  // Sprint 3 Story 2.5 — per-sub-order timestamps surfaced so the
  // timeline panel can show "seller must accept by ..." countdown and
  // last shipment update without re-deriving them.
  acceptDeadlineAt?: string | null;
  lastTrackingEventAt?: string | null;
  // Delivery method fields surfaced by the API. Optional because
  // historical orders pre-feature have NULL here.
  deliveryMethod?: 'ITHINK_LOGISTICS' | 'SELF_DELIVERY' | null;
  ithinkAwb?: string | null;
  ithinkLogistic?: string | null;
  ithinkTrackingUrl?: string | null;
  selfDeliveryStatus?:
    | 'PENDING'
    | 'READY_FOR_PICKUP'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'FAILED'
    | 'CANCELLED'
    | null;
  items: OrderItem[];
}

// Sprint 3 Story 2.5 — synthesized buyer timeline. Each event has a
// stable `kind` the UI can switch on for icons/colours plus a
// pre-localised English `label`. Optional `subOrderId` lets the UI
// associate a row with a specific shipment (e.g. multi-seller order).
export interface OrderTimelineEvent {
  kind:
    | 'ORDER_PLACED'
    | 'ORDER_VERIFIED'
    | 'TRACKING_UPDATED'
    | 'SHIPMENT_DELIVERED'
    | 'ORDER_CANCELLED'
    | string;
  label: string;
  at: string;
  subOrderId?: string;
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
  // Shipping snapshot (v1). Null when shipping was free.
  shipping?: {
    optionName: string | null;
    feeInPaise: string;
    feeInRupees: string;
  } | null;
  // Sprint 3 Story 2.5 — synthesized event list, oldest first.
  timeline?: OrderTimelineEvent[];
  // Phase 26 GST — per-item tax snapshot + roll-up totals. Empty
  // taxSnapshots for legacy orders without allocation; the UI hides
  // the breakdown card when the array is empty.
  taxSnapshots?: OrderItemTaxSnapshot[];
  taxSummary?: {
    taxableInPaise: string;
    cgstInPaise: string;
    sgstInPaise: string;
    igstInPaise: string;
    totalTaxInPaise: string;
  };
}

export interface OrderItemTaxSnapshot {
  orderItemId: string;
  grossLineAmountInPaise: string;
  discountAmountInPaise: string;
  taxableAmountInPaise: string;
  gstRateBps: number;
  cgstAmountInPaise: string;
  sgstAmountInPaise: string;
  igstAmountInPaise: string;
  totalTaxAmountInPaise: string;
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
