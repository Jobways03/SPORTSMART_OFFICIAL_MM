/**
 * Delhivery cancellation + updation wire shapes.
 *
 * Delhivery reuses `POST /api/p/edit` for BOTH cancellation and
 * shipment-detail updates:
 *
 *   • Cancellation — send `{ waybill, cancellation: "true" }` (the
 *     literal string "true", not a JSON boolean).
 *   • Updation     — send `{ waybill, ...fields-to-change }`.
 *
 * Allowed statuses for edit/cancel (per the developer portal):
 *   • Forward:  Manifested, In Transit, Pending
 *   • RVP:      Scheduled
 *   • REPL:     Manifested / In Transit / Pending
 *   • DISALLOWED: Delivered, DTO, RTO, LOST, Closed
 *
 * Payment-mode swap rules (updation):
 *   • COD <-> Prepaid is allowed (must include `cod` when going to
 *     COD).
 *   • Pickup / REPL CANNOT be swapped with COD / Prepaid.
 *
 * Cancellation behaviour:
 *   • Manifested + cancel → stays Manifested with `status_type = UD`.
 *   • In-Transit + cancel → stays In-Transit with `status_type = RT`
 *                           (returns to origin).
 *   • Scheduled  + cancel → Canceled with `status_type = CN`.
 */

/** Only `waybill` is required; everything else is a caller-supplied diff. */
export interface DelhiveryUpdateShipmentRequest {
  waybill: string;
  /** Payment mode swap — COD <-> Pre-paid only. */
  pt?: 'COD' | 'Pre-paid';
  /** COD amount in INR; required when pt is being flipped to "COD". */
  cod?: number;
  /** Consignee name. */
  name?: string;
  /** Consignee phone. */
  phone?: string;
  /** Consignee address (single string — Delhivery doesn't split lines). */
  add?: string;
  /** Products description. */
  products_desc?: string;
  /** Weight in grams. */
  gm?: number;
  /** Dimensions in cm. */
  shipment_height?: number;
  shipment_width?: number;
  shipment_length?: number;
}

export interface DelhiveryCancelRequest {
  waybill: string;
  /** Always `"true"` for a cancellation call (Delhivery wants the string). */
  cancellation: 'true';
}

/**
 * Envelope returned by both cancellation and updation calls.
 *
 * Delhivery surfaces a top-level `status` keyword and (on failure)
 * a `remarks` array. On success the AWB is echoed back.
 */
export interface DelhiveryEditOrCancelResponse {
  /** "Success" | "Failure" — Delhivery's textual status, not a boolean. */
  status?: string;
  /** AWB that was actioned. */
  waybill?: string;
  /** Status type for cancellation: UD / RT / CN. */
  status_type?: string;
  /** Failure remark / detail strings. */
  remarks?: string | string[];
  /** Top-level error code (when Delhivery surfaces one). */
  error?: unknown;
}
