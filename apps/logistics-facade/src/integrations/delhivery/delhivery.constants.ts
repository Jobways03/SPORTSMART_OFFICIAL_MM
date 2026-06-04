/**
 * Stable identifiers and tuneables for the Delhivery integration.
 *
 * Every value the rest of the app might want to reference (DI tokens,
 * partner code, retry budgets, base path roots) lives here so call
 * sites import a `const` rather than re-typing a string.
 *
 * Mirrors `apps/logistics-facade/src/integrations/shadowfax/shadowfax.constants.ts`.
 *
 * Delhivery's "one" developer portal (https://one.delhivery.com/) is
 * the current source of truth. All paths below have been CONFIRMED
 * against the live developer portal — Test host
 * `staging-express.delhivery.com`, Production host `track.delhivery.com`.
 */

import type { PartnerCode } from '@sportsmart/logistics-contracts';

/**
 * Canonical partner code. Imported wherever the adapter needs to
 * advertise itself (resolver registration, webhook routing, log
 * tags). Sourced from the Zod enum so a typo here fails at compile
 * time rather than at runtime in a partner selector.
 */
export const DELHIVERY_PARTNER_CODE: PartnerCode = 'DELHIVERY';

/**
 * Display name shown in admin UIs / logs. Kept separate from the
 * partner code so we can rename the marketing label without breaking
 * the wire enum.
 */
export const DELHIVERY_DISPLAY_NAME = 'Delhivery';

/** DI tokens. */
export const DELHIVERY_CLIENT = Symbol('DELHIVERY_CLIENT');
export const DELHIVERY_CONFIG = Symbol('DELHIVERY_CONFIG');

/**
 * Retry budget for transient partner-side errors (5xx, ETIMEDOUT,
 * ECONNRESET). Pure-read calls (track, serviceability) may retry up
 * to RETRY_MAX_ATTEMPTS; write calls (create-shipment) MUST send
 * an idempotency key so retries don't double-book.
 */
export const DELHIVERY_RETRY_MAX_ATTEMPTS = 2;
export const DELHIVERY_RETRY_BASE_DELAY_MS = 500;

/**
 * Auth header. Delhivery uses a long-lived token issued from the
 * "one" developer portal; rotated by ops via a Vault entry.
 *
 * Header format: `Authorization: Token <api-token>`.
 */
export const DELHIVERY_AUTH_HEADER = 'Authorization';
export const DELHIVERY_AUTH_SCHEME = 'Token';

/** Webhook signature header (M1 webhook handler). */
export const DELHIVERY_WEBHOOK_SIGNATURE_HEADER = 'X-Delhivery-Signature';

/**
 * Known Delhivery scan-code prefixes. Used by the status mapper.
 * NOT exhaustive — populate as we encounter codes in sandbox; the
 * mapper falls back to EXCEPTION for anything unknown and logs the
 * raw code so the dictionary can be expanded.
 */
export const DELHIVERY_STATUS_PREFIXES = {
  MANIFESTED: 'Manifested',
  IN_TRANSIT: 'In Transit',
  PENDING: 'Pending',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  RTO: 'RTO',
  NDR: 'Undelivered',
  CANCELLED: 'Cancelled',
  LOST: 'Lost',
  DAMAGED: 'Damaged',
} as const;

/**
 * Delhivery API path roots. Values are RELATIVE to `DELHIVERY_API_URL`
 * — do NOT include the host or trailing slash here.
 *
 * Source of truth: one.delhivery.com/developer-portal/documents/b2c.
 * All paths below have been CONFIRMED against the live developer
 * portal (May 2026). Test host: `staging-express.delhivery.com`;
 * production host: `track.delhivery.com`.
 */
export const DELHIVERY_PATHS = {
  // Pincode Serviceability (B2C).
  SERVICEABILITY: '/c/api/pin-codes/json/',

  // Heavy product-type serviceability — distinct endpoint from the
  // regular B2C serviceability check. "NSZ" in the response payload
  // means non-serviceable for the requested pincode.
  HEAVY_SERVICEABILITY: '/api/dc/fetch/serviceability/pincode',

  // Expected TAT between origin + destination pincodes for a given
  // mode of transport (S/E/N).
  EXPECTED_TAT: '/api/dc/expected_tat',

  // Fetch Waybill (bulk). `?count=N` — capped at 10,000 per request
  // and 50,000 per 5-minute window. Backend allocates in batches of
  // 25.
  FETCH_WAYBILL_BULK: '/waybill/api/bulk/json/',

  // Fetch Waybill (single). `?token=<token>` — one AWB per call.
  FETCH_WAYBILL_SINGLE: '/waybill/api/fetch/json/',

  // Shipment Manifestation API. Form-style POST: body shape is
  // `format=json&data=<URL_ENCODED_JSON>`. Also used for RVP QC 3.0
  // (the reverse flow injects `payment_mode: "Pickup"`, `qc_type:
  // "param"`, and a `custom_qc` array into the same shipment row).
  CREATE_SHIPMENT: '/api/cmu/create.json',

  // Shipment Updation + Shipment Cancellation share `/api/p/edit`.
  // Update sends the field diff; cancel sends `cancellation: "true"`
  // (string, not boolean).
  EDIT_OR_CANCEL: '/api/p/edit',

  // Shipment Tracking. `?waybill=<comma-separated>` (max 50) or
  // `?ref_ids=<order_ids>`. Either is acceptable.
  TRACK: '/api/v1/packages/json/',

  // Generate Shipping Label. `?wbns=<csv>&pdf=true&pdf_size=A4`.
  // `pdf=true` returns an S3 PDF link; `pdf=false` returns JSON for
  // custom rendering. `pdf_size`: A4 (8x11) or 4R (4x6).
  LABEL: '/api/p/packing_slip',

  // Calculate Shipping Cost (live rate quote).
  CALCULATE_COST: '/api/kinko/v1/invoice/charges/.json',

  // Pickup Request Creation. Raised against a warehouse (not a
  // waybill). One pickup request per warehouse per day until the
  // previous one closes.
  PICKUP_REQUEST: '/fm/request/new/',

  // Client Warehouse — register + update.
  WAREHOUSE_CREATE: '/api/backend/clientwarehouse/create/',
  WAREHOUSE_UPDATE: '/api/backend/clientwarehouse/edit/',

  // NDR — apply action (RE-ATTEMPT | PICKUP_RESCHEDULE). Async —
  // returns a UPL ID; poll status via NDR_STATUS.
  NDR_ACTION: '/api/p/update',

  // NDR — get status. Append `{UPL_ID}?verbose=true` to this path.
  NDR_STATUS: '/api/cmu/get_bulk_upl/',

  // Ewaybill Update — PUT. Append `{waybill}/` to this path. Body =
  // `{"data": [{"dcn": invoice_number, "ewbn": ewb_number}]}`.
  // Required when shipment value > ₹50,000.
  EWAYBILL: '/api/rest/ewaybill/',
} as const;

/** Tracking call accepts up to 50 AWBs per request — chunk above this. */
export const DELHIVERY_TRACK_MAX_AWBS = 50;

/** Fetch-waybill bulk allocation: max 10,000 per call. */
export const DELHIVERY_FETCH_WAYBILL_MAX = 10_000;

/** Label endpoint: cap CSV at 100 AWBs per call. */
export const DELHIVERY_LABEL_MAX_AWBS = 100;
