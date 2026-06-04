/**
 * Stable identifiers and tuneables for the Shadowfax integration.
 *
 * Shadowfax operates two product lines that the facade needs to
 * choose between at booking time:
 *   • Intracity / on-demand    — quick-delivery within a metro,
 *                                 same-day or 60–90 min slots.
 *   • Express / nationwide     — standard inter-city forward + reverse.
 *
 * The adapter decides which product line to use based on the
 * canonical request's mode (see comment in
 * `adapters/shadowfax-courier.adapter.ts`).
 *
 * Mirrors apps/api/src/integrations/ithink/ithink.constants.ts.
 */

import type { PartnerCode } from '@sportsmart/logistics-contracts';

export const SHADOWFAX_PARTNER_CODE: PartnerCode = 'SHADOWFAX';
export const SHADOWFAX_DISPLAY_NAME = 'Shadowfax';

/** DI tokens. */
export const SHADOWFAX_CLIENT = Symbol('SHADOWFAX_CLIENT');
export const SHADOWFAX_CONFIG = Symbol('SHADOWFAX_CONFIG');

/**
 * Retry budget for transient partner-side errors. Shadowfax has
 * historically been chattier than Delhivery — keep the budget short
 * so we fail over to the secondary carrier faster.
 */
export const SHADOWFAX_RETRY_MAX_ATTEMPTS = 2;
export const SHADOWFAX_RETRY_BASE_DELAY_MS = 200;

/** Auth header. Shadowfax accepts `Token` or `Bearer` — team confirms. */
export const SHADOWFAX_AUTH_HEADER = 'Authorization';
export const SHADOWFAX_AUTH_SCHEME = 'Token';

/** Webhook signature header. */
export const SHADOWFAX_WEBHOOK_SIGNATURE_HEADER = 'X-Shadowfax-Signature';

/**
 * Shadowfax product line. The adapter picks one based on whether
 * the canonical request is for a hyperlocal pickup-slot booking
 * (INTRACITY) or a standard ship-to-customer flow (EXPRESS).
 */
export type ShadowfaxProductLine = 'INTRACITY' | 'EXPRESS';

/**
 * Known Shadowfax status keywords. Source: Shadowfax integration
 * guide; refine on first real webhook stream.
 */
export const SHADOWFAX_STATUS_KEYWORDS = {
  ASSIGNED: 'ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  RTO: 'RTO',
  NDR: 'UNDELIVERED',
  CANCELLED: 'CANCELLED',
} as const;

/**
 * Shadowfax API path roots. Sourced from the Shadowfax marketplace
 * Apiary docs — confirm against the canonical doc URLs when filling
 * in the remaining stubs.
 *
 * NOTE: paths are relative to `SHADOWFAX_API_URL` (`.../api`) — do
 * NOT include the `/api` prefix here. Marketplace endpoints live on
 * Dale; QR/label endpoints live on Saruman (see qrApiUrl in config).
 */
export const SHADOWFAX_PATHS = {
  /**
   * Order create — POST. Same endpoint for marketplace + warehouse;
   * the request body's `order_type` literal picks the product line.
   */
  CREATE_ORDER: '/v3/clients/orders/',
  /** Legacy alias kept for back-compat with older call sites. */
  MARKETPLACE_CREATE_ORDER: '/v3/clients/orders/',
  /**
   * Serviceability check — GET with query string:
   *   ?service=<service>&pincodes=<csv>&page=<n>&count=<n>
   * Valid `service` values: seller_pickup, customer_delivery,
   * customer_pickup, seller_delivery, warehouse_pickup, warehouse_return.
   */
  SERVICEABILITY: '/v1/clients/serviceability/',
  /** AWB generation — POST, body `{ count: N }` (max 100000). */
  GENERATE_AWB: '/v3/clients/orders/generate_awb/',
  /**
   * Single-AWB tracking — GET. Path is templated: replace `{awb}`
   * with the actual AWB before issuing the request.
   */
  TRACK_BY_AWB: '/v4/clients/orders/{awb}/track/',
  /** Bulk tracking — POST, body `{ awb_numbers: [...] }` (max 50). */
  BULK_TRACK: '/v4/clients/bulk_track/',
  /** Order update — POST. Used for delivery/pickup/return amendments. */
  ORDER_UPDATE: '/v3/clients/order_update/',
  /** Cancel — POST, body `{ request_id, cancel_remarks }`. */
  CANCEL: '/v3/clients/orders/cancel/',
  /** Label fetch — GET, suffixed with /:id/label. */
  LABEL: '/v3/clients/orders', // /:id/label
  /** NDR reattempt — POST. */
  NDR_REATTEMPT: '/v3/clients/orders', // /:id/reattempt
} as const;

/** Bulk-tracking call limit enforced by Shadowfax server-side. */
export const SHADOWFAX_BULK_TRACK_MAX_AWBS = 50;
