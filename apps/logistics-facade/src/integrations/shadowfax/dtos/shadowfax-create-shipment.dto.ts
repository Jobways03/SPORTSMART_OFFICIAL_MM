/**
 * Shadowfax create-order wire shapes — marketplace + warehouse.
 *
 * Endpoint: `POST /v3/clients/orders/`
 *
 * Source: Shadowfax marketplace + warehouse API specs (Apiary docs).
 * The shape is a 1:1 mirror of the partner format so the mapper layer
 * is the only place that knows about the canonical -> wire translation.
 *
 * Quirks worth remembering when reading this file:
 *   • Money is INR rupees (number), NOT paise.
 *   • Pincodes are NUMBERS, not strings — Shadowfax 400s on string.
 *   • Errors arrive with HTTP 200 + `message: "Failure"` (see
 *     mappers/shadowfax-error.mapper.ts for the dictionary).
 *   • The success envelope's `payment_mode` echoes lowercase
 *     (`"cod" | "prepaid"`), but the REQUEST payload uses
 *     PascalCase (`"COD" | "Prepaid"`). Different casing is
 *     intentional on the partner side.
 *   • Warehouse mode uses `rto_details` (return-to-origin) instead of
 *     `rts_details` (return-to-seller). Same nested shape, different
 *     name. Marketplace uses `rts_details`; warehouse uses `rto_details`.
 *   • Warehouse `customer_details.location_type` is an optional
 *     literal that the docs spell `"residential" | "Commercial"`
 *     (yes — lowercase first, capital second). Match the docs exactly.
 */

/** Address echo in the success response. */
export interface ShadowfaxAddress {
  name: string;
  contact: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: number;
  alternate_contact: string | null;
  sms_contact: string | null;
  latitude: string;
  longitude: string;
}

/* ─── Reusable request blocks ───────────────────────────────────── */

export interface ShadowfaxOrderDetails {
  /** Required, max 100 chars. The facade's subOrderId. */
  client_order_id: string;
  /** Optional, max 100. Omit to let Shadowfax auto-assign. */
  awb_number?: string;
  /** Grams; default 0. */
  actual_weight?: number;
  /** Grams; volumetric = l*b*h/5000. Default 0. */
  volumetric_weight?: number;
  /** INR; sum of SKU values exclusive of tax. */
  product_value: number;
  /** INR. 0 for prepaid orders. */
  cod_amount: number;
  payment_mode: 'COD' | 'Prepaid';
  /** YYYY-MM-DD. */
  promised_delivery_date?: string;
  /** INR inclusive of tax. */
  total_amount?: number;
  /** Max 12 chars. */
  eway_bill?: string;
  /** Max 50 chars. */
  gstin_number?: string;
  /** Defaults server-side to "regular". */
  order_service?: string;
}

export interface ShadowfaxCustomerDetails {
  name: string;
  /** Min 10 digits, max 13 chars. */
  contact: string;
  alternate_contact?: string;
  address_line_1: string;
  address_line_2?: string;
  /** Max 50 chars. */
  city: string;
  /** Max 50 chars. */
  state: string;
  /** 6-digit NUMBER (not string — partner 400s on string). */
  pincode: number;
  latitude?: string;
  longitude?: string;
}

export interface ShadowfaxPickupDetails {
  /** Max 100 chars. */
  name?: string;
  contact: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  pincode: number;
  latitude?: string;
  longitude?: string;
  /** Max 255 chars — seller/warehouse identifier. */
  unique_code?: string;
}

/**
 * Reused for both `rts_details` (marketplace) and `rto_details`
 * (warehouse). Shape is identical; the partner just renames the
 * top-level key based on `order_type`.
 */
export interface ShadowfaxReturnAddressDetails {
  name: string;
  contact: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  pincode: number;
  email?: string;
  latitude?: string;
  longitude?: string;
  unique_code?: string;
}

export interface ShadowfaxProductLine {
  sku_id?: string;
  /** Required. */
  sku_name: string;
  /** Max 50 chars. */
  hsn_code?: string;
  /** Max 50 chars. */
  invoice_no?: string;
  /** Max 200 chars. */
  category?: string;
  /** INR. Required. */
  price: number;
  seller_details?: {
    /** Max 100 chars. */
    seller_name?: string;
    seller_address?: string;
    /** Max 50 chars. */
    seller_state?: string;
    /** Max 50 chars. */
    gstin_number?: string;
  };
  taxes?: {
    cgst?: number;
    sgst?: number;
    igst?: number;
    total_tax?: number;
  };
  additional_details?: {
    /** String "True" | "False", not boolean — partner accepts both
     *  but the spec writes the string form. */
    requires_extra_care?: 'True' | 'False';
    type_extra_care?: string;
    quantity?: number;
  };
}

/* ─── Request — marketplace ──────────────────────────────────────── */

export interface ShadowfaxCreateMarketplaceRequest {
  /** Marketplace-mode literal. */
  order_type: 'marketplace';
  order_details: ShadowfaxOrderDetails;
  customer_details: ShadowfaxCustomerDetails;
  pickup_details: ShadowfaxPickupDetails;
  /** Return-to-seller address. */
  rts_details: ShadowfaxReturnAddressDetails;
  product_details: ShadowfaxProductLine[];
}

/* ─── Request — warehouse ────────────────────────────────────────── */

export interface ShadowfaxCreateWarehouseRequest {
  /** Warehouse-mode literal. */
  order_type: 'warehouse';
  order_details: ShadowfaxOrderDetails;
  customer_details: ShadowfaxCustomerDetails & {
    /**
     * Optional drop-address classification. Docs spell the values
     * `"residential" | "Commercial"` (lowercase first, capital second)
     * — match the docs exactly even though it looks like a typo.
     */
    location_type?: 'residential' | 'Commercial';
  };
  pickup_details: ShadowfaxPickupDetails;
  /**
   * Return-to-origin address — same shape as `rts_details` in
   * marketplace mode, different key. Shadowfax renames it because the
   * semantic is "back to the original sender" (the warehouse) rather
   * than "back to the marketplace seller".
   */
  rto_details: ShadowfaxReturnAddressDetails;
  product_details: ShadowfaxProductLine[];
}

/** Discriminated union of the two supported modes. */
export type ShadowfaxCreateOrderRequest =
  | ShadowfaxCreateMarketplaceRequest
  | ShadowfaxCreateWarehouseRequest;

/* ─── Response ──────────────────────────────────────────────────── */

export interface ShadowfaxCreateOrderSuccess {
  message: 'Success';
  errors: null;
  data: {
    id: number;
    client_name: string;
    client_order_id: string;
    awb_number: string;
    product_value: number;
    cod_amount: number;
    payment_mode: 'prepaid' | 'cod';
    /** YYYY-MM-DD. */
    order_date: string;
    promised_delivery_date: string | null;
    /** Human-friendly status — typically "New" at creation. */
    status_display: string;
    /** Machine status — typically "new" at creation. */
    status: string;
    pickup_details: ShadowfaxAddress;
    delivery_details: ShadowfaxAddress;
    product_details: Array<{
      sku_id: string;
      sku_name: string;
      price: number;
      return_reason: string | null;
      category: string | null;
      brand: string | null;
      /** JSON string. */
      additional_details: string;
      seller_name: string | null;
      seller_address: string | null;
      seller_state: string | null;
      hsn_code: string | null;
      invoice_no: string | null;
      sgst_amount: number;
      cgst_amount: number;
      igst_amount: number;
      gstin_number: string;
      total_tax_value: number;
      qc_required: boolean;
      qc_rules: string;
    }>;
    eway_bill_number: string | null;
    invoice_date: string | null;
    sort_code: string | null;
  };
}

export interface ShadowfaxCreateOrderFailure {
  message: 'Failure';
  /**
   * Shadowfax returns errors in three shapes depending on which
   * validator complained:
   *   • Plain string                       — top-level rejection.
   *   • Array of strings                   — list of error messages.
   *   • Object with nested string arrays   — field-level errors.
   * The error mapper handles all three uniformly.
   */
  errors: string | string[] | Record<string, unknown>;
  data?: Record<string, unknown>;
  /** Populated when the failure is a duplicate-order rejection. */
  COID?: string;
  /** Populated when the failure is a duplicate-AWB rejection. */
  AWB?: string;
}

export type ShadowfaxCreateOrderResponse =
  | ShadowfaxCreateOrderSuccess
  | ShadowfaxCreateOrderFailure;

/* ─── Type guards ───────────────────────────────────────────────── */

export function isShadowfaxCreateOrderSuccess(
  x: unknown,
): x is ShadowfaxCreateOrderSuccess {
  if (typeof x !== 'object' || x === null) return false;
  const candidate = x as { message?: unknown; data?: unknown };
  return (
    candidate.message === 'Success' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null
  );
}

export function isShadowfaxCreateOrderFailure(
  x: unknown,
): x is ShadowfaxCreateOrderFailure {
  if (typeof x !== 'object' || x === null) return false;
  const candidate = x as { message?: unknown };
  return candidate.message === 'Failure';
}
