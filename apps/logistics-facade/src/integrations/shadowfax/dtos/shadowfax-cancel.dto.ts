/**
 * Shadowfax cancellation wire shapes.
 *
 * Endpoint: `POST /v3/clients/orders/cancel/`
 *
 * Request:
 *   { request_id: string; cancel_remarks: string }
 *
 *   `request_id` can be either an AWB or a `client_order_id` — the
 *   partner resolves both. Caller validates `cancel_remarks` is
 *   non-empty before posting.
 *
 * Response: 200 (always — including failures) with body:
 *   { responseMsg: string; responseCode: number }
 *
 * Documented outcome shapes (mapped to a canonical state machine
 * exposed to the rest of the facade):
 *
 *   • responseCode 200, msg "Request has been marked as cancelled"
 *       → state CANCELLED (terminal)
 *   • responseCode 304, msg "Request is queued for cancellation."
 *       → state CANCEL_QUEUED (in-transit; SFX cancels at the next
 *         facility scan)
 *   • responseCode 200, msg "The request is already in its
 *     cancellation phase"
 *       → state ALREADY_CANCELLED (idempotent replay)
 *
 * Other docs-listed failure messages — all surfaced via the error
 * mapper as `VALIDATION_FAILED` with the raw partner string preserved
 * in `detail`:
 *   • "Invalid state"
 *   • "Multiple Orders found"
 *   • "Cannot cancel from Pincode Updated"
 *   • "Invalid AWB"
 *   • "Unable to cancel"
 */

export interface ShadowfaxCancelRequest {
  /** AWB or client_order_id of the shipment being cancelled. */
  request_id: string;
  /** Free-form cancel reason; required by the partner. */
  cancel_remarks: string;
}

export interface ShadowfaxCancelResponse {
  responseMsg: string;
  responseCode: number;
}

/**
 * Canonical cancel outcome surfaced to the rest of the facade. Three
 * positive outcomes; the negative path is a thrown `CarrierError`.
 */
export type CanonicalCancelOutcome =
  | { state: 'CANCELLED' }
  /** Will cancel at the next SFX facility scan (in-transit). */
  | { state: 'CANCEL_QUEUED' }
  /** Idempotent — partner already had the cancellation on file. */
  | { state: 'ALREADY_CANCELLED' };

/* ─── Type guard ─────────────────────────────────────────────────── */

export function isShadowfaxCancelResponse(
  x: unknown,
): x is ShadowfaxCancelResponse {
  if (typeof x !== 'object' || x === null) return false;
  const candidate = x as { responseMsg?: unknown; responseCode?: unknown };
  return (
    typeof candidate.responseMsg === 'string' &&
    typeof candidate.responseCode === 'number'
  );
}
