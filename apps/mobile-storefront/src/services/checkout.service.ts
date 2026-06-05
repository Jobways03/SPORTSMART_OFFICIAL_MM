import {apiClient, ApiResponse} from '../lib/api-client';

export interface CheckoutItem {
  cartItemId: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  serviceable: boolean;
  unserviceableReason?: string;
  allocatedSellerName: string | null;
  estimatedDeliveryDays: number | null;
  reservationId: string | null;
}

export interface CheckoutData {
  items: CheckoutItem[];
  totalAmount: number;
  serviceableAmount: number;
  itemCount: number;
  allServiceable: boolean;
  unserviceableCount: number;
  addressSnapshot: Record<string, string>;
  expiresAt: string;
}

export interface PlaceOrderPayload {
  /** v1 mobile flow only supports ONLINE. COD support requires extra UI
   *  for the cash-handling consent step which web has but mobile defers. */
  paymentMethod: 'ONLINE' | 'COD';
  shippingOptionId?: string | null;
  couponCode?: string;
  referralCode?: string;
  walletApplyAmountInPaise?: number;
}

export interface PlaceOrderResponse {
  orderNumber: string;
}

export interface PaymentRetryResponse {
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
}

export interface PaymentVerifyPayload {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Preview of a coupon as returned by POST /customer/coupons/validate.
 * `discountAmount` is in rupees and matches what the customer will pay —
 * but it's advisory: the coupon is ALWAYS re-validated server-side at
 * place-order. Shape mirrors the web storefront's PreviewedCoupon.
 */
export interface PreviewedCoupon {
  code: string;
  title: string | null;
  valueType: string;
  value: number;
  discountAmount: number;
}

export const checkoutService = {
  /**
   * Locks the cart for checkout, allocates sellers per item, calculates
   * serviceability + delivery estimates. Must be called before place-order.
   * Body is empty; the active session's cart + default address are used
   * unless the user picked a different address — for that, set the
   * default-address first via PATCH /customer/addresses/:id/set-default.
   */
  initiate(addressId: string): Promise<ApiResponse<CheckoutData>> {
    return apiClient<CheckoutData>('/customer/checkout/initiate', {
      method: 'POST',
      body: JSON.stringify({addressId}),
    });
  },

  /** Re-read the checkout snapshot without re-initiating. */
  summary(): Promise<ApiResponse<CheckoutData>> {
    return apiClient<CheckoutData>('/customer/checkout/summary');
  },

  /**
   * Preview a coupon against the current cart subtotal + items. The same
   * endpoint checkout uses, so the discountAmount shown here matches what
   * place-order will grant. Throws ApiError on a bad code (400) or
   * rate-limit (429 — body.retryAfterSeconds). The discount is always
   * re-validated server-side at place-order; this is purely a preview.
   */
  validateCoupon(
    code: string,
    subtotal: number,
    items: Array<{productId: string; quantity: number; unitPrice: number}>,
    currentCouponCode?: string,
  ): Promise<ApiResponse<PreviewedCoupon>> {
    return apiClient<PreviewedCoupon>('/customer/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({code, subtotal, items, currentCouponCode}),
    });
  },

  /** Trim items that can't ship to the selected address. */
  removeUnserviceable(): Promise<ApiResponse<CheckoutData>> {
    return apiClient<CheckoutData>('/customer/checkout/remove-unserviceable', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /**
   * Place the order. Backend requires X-Idempotency-Key — the caller
   * must generate one stable key per checkout attempt and reuse it on
   * retries so a double-tap doesn't create two orders. Returns the
   * orderNumber; for ONLINE orders, follow with retryPayment() to get
   * the Razorpay handoff data.
   */
  placeOrder(
    payload: PlaceOrderPayload,
    idempotencyKey: string,
  ): Promise<ApiResponse<PlaceOrderResponse>> {
    return apiClient<PlaceOrderResponse>('/customer/checkout/place-order', {
      method: 'POST',
      headers: {'X-Idempotency-Key': idempotencyKey},
      body: JSON.stringify(payload),
    });
  },

  /**
   * Start (or restart) a Razorpay session for an existing ONLINE order
   * that hasn't yet been paid. Returns the data needed to open the
   * native Razorpay sheet.
   */
  retryPayment(orderNumber: string): Promise<ApiResponse<PaymentRetryResponse>> {
    return apiClient<PaymentRetryResponse>(
      '/customer/checkout/payment/retry',
      {
        method: 'POST',
        body: JSON.stringify({orderNumber}),
      },
    );
  },

  /**
   * Verify the HMAC-SHA256 signature Razorpay returned after the
   * customer paid in the sheet. Backend recomputes the signature against
   * its Razorpay secret before flipping the payment to PAID — we never
   * trust the client alone.
   */
  verifyPayment(
    payload: PaymentVerifyPayload,
  ): Promise<ApiResponse<{paymentStatus: string}>> {
    return apiClient<{paymentStatus: string}>(
      '/customer/checkout/payment/verify',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },
};
