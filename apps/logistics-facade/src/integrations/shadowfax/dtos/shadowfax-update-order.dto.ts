/**
 * Shadowfax order-update wire shapes.
 *
 * Endpoint: `POST /v3/clients/order_update/`
 *
 * Used after order creation to amend a shipment without re-booking
 * (e.g. customer changed their phone number, ops needs to flip COD to
 * prepaid, RTS/RTO transitions, NDR reopening).
 *
 * Quirks worth remembering:
 *   • The request key is `awb_numbers` (with the trailing `s`) but
 *     the value is a SINGLE awb string per the partner docs — match
 *     the spelling exactly.
 *   • At least one of the optional blocks must be present. The
 *     partner 400s on a body that's just `{ awb_numbers }`.
 *   • Pincode mutations are subject to two server-side limits:
 *       1. Max N updates per shipment (partner-configurable; see
 *          README for current ceiling)
 *       2. Intercity pincode changes (origin city ≠ destination
 *          city) are rejected outright.
 *     Both surface as 400 with descriptive partner strings — the
 *     error mapper routes them to `VALIDATION_FAILED`.
 *
 * Success: 200 with `{ "message": "Request accepted." }`.
 * Failure: 4xx with a specific reason string in the body.
 */

/** Mutable fields on the delivery (customer) address. */
export interface ShadowfaxUpdateDeliveryDetails {
  contact?: string;
  alternate_contact?: string;
  customer_address?: string;
  pincode?: number;
  latitude?: string;
  longitude?: string;
}

/** Mutable fields on the pickup (origin) address. */
export interface ShadowfaxUpdatePickupDetails {
  contact?: string;
  customer_address?: string;
  pincode?: number;
  latitude?: string;
  longitude?: string;
}

/** Mutable fields on the return-to-seller / return-to-origin address. */
export interface ShadowfaxUpdateReturnDetails {
  contact?: string;
  return_address?: string;
  pincode?: number;
  latitude?: string;
  longitude?: string;
}

/** Mutable order-level fields. */
export interface ShadowfaxUpdateOrderDetails {
  cod_amount?: number;
  eway_bill_number?: string;
  return_eway_bill_number?: string;
  invoice_number?: string;
  /** Grams. */
  actual_weight?: number;
  /** Grams. */
  volumetric_weight?: number;
}

/**
 * Status transitions allowed via the update endpoint. The partner
 * accepts only these three values — anything else is rejected.
 *   • "rts"        — start return-to-seller flow.
 *   • "rto"        — start return-to-origin flow.
 *   • "reopen_ndr" — undo a closed NDR (treat as re-deliverable).
 */
export type ShadowfaxUpdateStatusAction = 'rts' | 'rto' | 'reopen_ndr';

export interface ShadowfaxUpdateOrderRequest {
  /**
   * Single AWB the partner should mutate. Yes, the key has a trailing
   * `s` even though the value is a single string — that's how the
   * partner spec is written.
   */
  awb_numbers: string;
  delivery_details?: ShadowfaxUpdateDeliveryDetails;
  pickup_details?: ShadowfaxUpdatePickupDetails;
  return_details?: ShadowfaxUpdateReturnDetails;
  order_details?: ShadowfaxUpdateOrderDetails;
  status_update?: {
    status: ShadowfaxUpdateStatusAction;
  };
}

export interface ShadowfaxUpdateOrderSuccess {
  message: 'Request accepted.';
}

export interface ShadowfaxUpdateOrderFailure {
  message: string;
  errors?: string | string[] | Record<string, unknown>;
}

export type ShadowfaxUpdateOrderResponse =
  | ShadowfaxUpdateOrderSuccess
  | ShadowfaxUpdateOrderFailure;

export function isShadowfaxUpdateOrderSuccess(
  x: unknown,
): x is ShadowfaxUpdateOrderSuccess {
  if (typeof x !== 'object' || x === null) return false;
  const candidate = x as { message?: unknown };
  return candidate.message === 'Request accepted.';
}

/**
 * Canonical change payload accepted by the service layer. Field
 * names match the canonical / domain vocabulary rather than the
 * partner's; the service translates into the wire request.
 */
export interface CanonicalOrderUpdate {
  delivery?: {
    contact?: string;
    alternateContact?: string;
    address?: string;
    pincode?: string;
    latitude?: string;
    longitude?: string;
  };
  pickup?: {
    contact?: string;
    address?: string;
    pincode?: string;
    latitude?: string;
    longitude?: string;
  };
  return?: {
    contact?: string;
    address?: string;
    pincode?: string;
    latitude?: string;
    longitude?: string;
  };
  order?: {
    codAmountPaise?: bigint;
    ewayBillNumber?: string;
    returnEwayBillNumber?: string;
    invoiceNumber?: string;
    actualWeightGrams?: number;
    volumetricWeightGrams?: number;
  };
  statusUpdate?: ShadowfaxUpdateStatusAction;
}
