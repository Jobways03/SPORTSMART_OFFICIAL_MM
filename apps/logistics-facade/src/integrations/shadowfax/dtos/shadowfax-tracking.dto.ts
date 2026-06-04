/**
 * Shadowfax tracking wire shapes.
 *
 * Endpoints:
 *   • Single: `GET /v4/clients/orders/{awb_number}/track/`
 *   • Bulk:   `POST /v4/clients/bulk_track/` with `{ awb_numbers: [...] }`
 *                                              (max 50 per call)
 *
 * Single response (success):
 *   {
 *     "message": "Success",
 *     "order_details": { ...same as create-response.data, plus customer_track_url... },
 *     "tracking_details": [
 *       { "created": "ISO", "location": "...", "status_id": "ofd",
 *         "status": "Out For Delivery", "remarks": "...", "awb_number": "..." },
 *       ...
 *     ]
 *   }
 *
 * Bulk response (success):
 *   {
 *     "message": "Success",
 *     "data": [
 *       { ...order_details fields..., "tracking_details": [...] },
 *       ...
 *     ]
 *   }
 *
 * Errors: 401 (auth), 400 with messages like:
 *   • "Invalid AWB number" / "Invalid AWB Number"
 *   • "Number of AWBs exceeded. Max count allowed is 50"
 */

import type { ShadowfaxAddress } from './shadowfax-create-shipment.dto';

/** One scan record on the Shadowfax timeline. */
export interface ShadowfaxTrackingEvent {
  /** ISO-8601 timestamp of the scan. */
  created: string;
  /** Human-readable hub/city name. May be empty string. */
  location: string;
  /** Machine status code — fed to `mapShadowfaxStatus`. */
  status_id: string;
  /** Human-readable status label. */
  status: string;
  /** Free-form sub-status / remark; may be empty string. */
  remarks: string;
  /** Shipment AWB this event belongs to. */
  awb_number: string;
}

/**
 * Order snapshot returned alongside the tracking timeline. Same fields
 * as the `data` block on the create-order success envelope (minus the
 * nested `product_details` which the tracking endpoint omits) plus
 * `customer_track_url`.
 */
export interface ShadowfaxOrderSnapshot {
  id: number;
  client_name?: string;
  client_order_id: string;
  awb_number: string;
  product_value?: number;
  cod_amount?: number;
  payment_mode?: 'prepaid' | 'cod';
  order_date?: string;
  promised_delivery_date?: string | null;
  status_display?: string;
  /** Machine status — Shadowfax's authoritative current status. */
  status?: string;
  pickup_details?: ShadowfaxAddress;
  delivery_details?: ShadowfaxAddress;
  eway_bill_number?: string | null;
  invoice_date?: string | null;
  sort_code?: string | null;
  /** Customer-facing tracking URL (where present). */
  customer_track_url?: string;
}

/* ─── Responses ──────────────────────────────────────────────────── */

export interface ShadowfaxTrackOrderSuccess {
  message: 'Success';
  order_details: ShadowfaxOrderSnapshot;
  tracking_details: ShadowfaxTrackingEvent[];
}

export interface ShadowfaxBulkTrackEntry extends ShadowfaxOrderSnapshot {
  tracking_details: ShadowfaxTrackingEvent[];
}

export interface ShadowfaxBulkTrackSuccess {
  message: 'Success';
  data: ShadowfaxBulkTrackEntry[];
}

/**
 * Failure envelope shared by both single + bulk track. Shadowfax
 * returns this on 400/401 with a plain `message` field.
 */
export interface ShadowfaxTrackFailure {
  message: string;
  errors?: string | string[] | Record<string, unknown>;
}

export type ShadowfaxTrackOrderResponse =
  | ShadowfaxTrackOrderSuccess
  | ShadowfaxTrackFailure;

export type ShadowfaxBulkTrackResponse =
  | ShadowfaxBulkTrackSuccess
  | ShadowfaxTrackFailure;

/* ─── Type guards ────────────────────────────────────────────────── */

export function isShadowfaxTrackOrderSuccess(
  x: unknown,
): x is ShadowfaxTrackOrderSuccess {
  if (typeof x !== 'object' || x === null) return false;
  const candidate = x as {
    message?: unknown;
    order_details?: unknown;
    tracking_details?: unknown;
  };
  return (
    candidate.message === 'Success' &&
    typeof candidate.order_details === 'object' &&
    candidate.order_details !== null &&
    Array.isArray(candidate.tracking_details)
  );
}

export function isShadowfaxBulkTrackSuccess(
  x: unknown,
): x is ShadowfaxBulkTrackSuccess {
  if (typeof x !== 'object' || x === null) return false;
  const candidate = x as { message?: unknown; data?: unknown };
  return candidate.message === 'Success' && Array.isArray(candidate.data);
}
