/**
 * Shadowfax NDR action wire shapes.
 * Source: `POST /api/v1/orders/{order_id}/reattempt`.
 *
 * Shadowfax does NOT expose an explicit RTO-initiate endpoint —
 * RTO is triggered by Shadowfax-side ops after N undelivered
 * attempts. The adapter's `initiateRto` therefore translates to a
 * `CarrierCapabilityError` until / unless Shadowfax adds the call.
 */

export interface ShadowfaxReattemptRequest {
  /** ISO-8601 desired reattempt date. */
  reattempt_date: string;
  /** Time-window string e.g. "10:00-14:00". */
  reattempt_time?: string;
  /** Updated drop address (full block; partial updates not supported). */
  address?: {
    address_line_1: string;
    address_line_2?: string;
    pincode: string;
    city: string;
    state: string;
  };
  phone?: string;
  /** "HOME" | "OFFICE" — drives Shadowfax's slot allocator. */
  address_type?: 'HOME' | 'OFFICE';
}

export interface ShadowfaxReattemptResponse {
  success: boolean;
  order_id: string;
  message?: string;
}
