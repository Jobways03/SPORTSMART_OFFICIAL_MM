/**
 * iThink Logistics constants — endpoint paths, batch caps, status taxonomy.
 *
 * Most endpoints share `ITHINK_BASE_URL`. `Track Order` is the only one
 * that uses a separate `api.ithinklogistics.com` host in production; for
 * sandbox both collapse to `pre-alpha.ithinklogistics.com`, which is why
 * the client routes via `ITHINK_TRACK_URL` rather than hard-coding.
 */

export const ITHINK_PATHS = {
  ADD_ORDER: '/api_v3/order/add.json',
  SYNC_ORDER: '/api_v3/order/sync.json',
  CANCEL_ORDER: '/api_v3/order/cancel.json',
  ORDER_DETAILS: '/api_v3/order/get_details.json',
  UPDATE_PAYMENT: '/api_v3/order/update-payment.json',
  GET_AIRWAYBILL: '/api_v3/order/get_awb.json',
  TRACK_ORDER: '/api_v3/order/track.json',
  PRINT_LABEL: '/api_v3/shipping/label.json',
  PRINT_MANIFEST: '/api_v3/shipping/manifest.json',
  PRINT_INVOICE: '/api_v3/shipping/invoice.json',
  CHECK_PINCODE: '/api_v3/pincode/check.json',
  GET_RATE: '/api_v3/rate/check.json',
  GET_ZONE_RATE: '/api_v3/rate/zone_rate.json',
  GET_STATE: '/api_v3/state/get.json',
  GET_CITY: '/api_v3/city/get.json',
  ADD_WAREHOUSE: '/api_v3/warehouse/add.json',
  GET_WAREHOUSE: '/api_v3/warehouse/get.json',
  GET_REMITTANCE: '/api_v3/remittance/get.json',
  GET_REMITTANCE_DETAILS: '/api_v3/remittance/get_details.json',
  NDR_REATTEMPT_RTO: '/api_v3/ndr/add-reattempt-rto.json',
  // Store endpoints are not used by the marketplace integration; kept
  // here for completeness if we ever pull store-connected orders.
  GET_STORE: '/api_v3/store/get.json',
  STORE_ORDER_DETAILS: '/api_v3/store/get-order-details.json',
  STORE_ORDER_LIST: '/api_v3/store/get-order-list.json',
} as const;

/** Per-endpoint request batch caps documented by iThink. */
export const ITHINK_BATCH_LIMITS = {
  ADD_ORDER_SHIPMENTS: 10,
  ADD_ORDER_PRODUCTS_PER_SHIPMENT: 40,
  TRACK_ORDER_AWBS: 10,
  CANCEL_ORDER_AWBS: 100,
  PRINT_LABEL_AWBS: 100,
  PRINT_INVOICE_AWBS: 100,
  SYNC_ORDER_SHIPMENTS: 25,
  ORDER_DETAILS_MAX_AWBS_PER_REQUEST: 500,
  GET_AIRWAYBILL_WINDOW_MINUTES: 30,
} as const;

/**
 * NDR action codes per iThink's `add-reattempt-rto.json` contract.
 * 1 = retry delivery with a new address/time. 2 = give up, return to origin.
 */
export const ITHINK_NDR_ACTION = {
  REATTEMPT: 1,
  RTO: 2,
} as const;

/**
 * NDR address-type codes for reattempt requests. iThink uses these to
 * decide whether their delivery agent expects a home or office context
 * (different success heuristics).
 */
export const ITHINK_NDR_ADDRESS_TYPE = {
  HOME: 1,
  OFFICE: 2,
} as const;

/**
 * Carriers iThink can route through. The set varies by account tier —
 * always validate against the account's allowed list before sending.
 * Reverse shipments are restricted to a smaller subset.
 */
export const ITHINK_FORWARD_LOGISTICS = [
  'delhivery',
  'bluedart',
  'xpressbees',
  'ecom',
  'ekart',
  'fedex',
] as const;
export type IThinkForwardLogistics = (typeof ITHINK_FORWARD_LOGISTICS)[number];

export const ITHINK_REVERSE_LOGISTICS = [
  'delhivery',
  'bluedart',
  'xpressbees',
] as const;
export type IThinkReverseLogistics = (typeof ITHINK_REVERSE_LOGISTICS)[number];

export const ITHINK_PAYMENT_MODES = ['cod', 'Prepaid'] as const;
export type IThinkPaymentMode = (typeof ITHINK_PAYMENT_MODES)[number];

export const ITHINK_ORDER_TYPES = ['forward', 'reverse'] as const;
export type IThinkOrderType = (typeof ITHINK_ORDER_TYPES)[number];

/**
 * Service type values are carrier-conditional:
 *  - bluedart / delhivery → 'air' | 'surface'
 *  - fedex                → 'standard' | 'priority' | 'ground'
 *  - others               → leave blank
 * Enforced cross-field in the DTO validator, not here.
 */
export const ITHINK_S_TYPE_VALUES = [
  'air',
  'surface',
  'standard',
  'priority',
  'ground',
  '',
] as const;

/**
 * Full status taxonomy from iThink's tracking docs. We deliberately map
 * on the verbose `status` string, not on `status_code`, because the
 * code column collapses ~25 distinct verbose values onto `UD` — losing
 * information our ops/admin UI needs.
 */
export const ITHINK_STATUS_CODES = {
  UNDELIVERED: 'UD',
  DELIVERED: 'DL',
  CANCELLED: 'CN',
  RTO: 'RT',
  LOST: 'Lost',
  SHORTAGE: 'Shortage',
  RTO_SHORTAGE: 'RTO Shortage',
} as const;

/** Verbose status strings; one of these will appear in `current_status`. */
export const ITHINK_STATUSES = {
  // Forward lifecycle
  MANIFESTED: 'Manifested',
  NOT_PICKED: 'Not Picked',
  PICKED_UP: 'Picked Up',
  IN_TRANSIT: 'In Transit',
  REACHED_AT_DESTINATION: 'Reached At Destination',
  OUT_FOR_DELIVERY: 'Out For Delivery',
  UNDELIVERED: 'Undelivered',
  OUT_OF_DELIVERY_AREA: 'Out of Delivery Area',
  DELAYED: 'Delayed',
  DAMAGED: 'Damaged',
  MISROUTED: 'Misrouted',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  // RTO lifecycle
  RTO_PENDING: 'RTO Pending',
  RTO_PROCESSING: 'RTO Processing',
  RTO_IN_TRANSIT: 'RTO In Transit',
  REACHED_AT_ORIGIN: 'Reached At Origin',
  RTO_OUT_FOR_DELIVERY: 'RTO Out For Delivery',
  RTO_UNDELIVERED: 'RTO Undelivered',
  RTO_DELIVERED: 'RTO Delivered',
  // Generic loss
  LOST: 'Lost',
  SHORTAGE: 'Shortage',
  RTO_SHORTAGE: 'RTO Shortage',
  // Reverse pickup lifecycle
  REV_MANIFEST: 'REV Manifest',
  REV_OUT_FOR_PICKUP: 'REV Out for Pick Up',
  REV_PICKED_UP: 'REV Picked Up',
  REV_IN_TRANSIT: 'REV In Transit',
  REV_CANCELLED: 'REV Cancelled',
  REV_OUT_FOR_DELIVERY: 'REV Out For Delivery',
  REV_DELIVERED: 'REV Delivered',
  REV_CLOSED: 'REV Closed',
} as const;
export type IThinkStatus = (typeof ITHINK_STATUSES)[keyof typeof ITHINK_STATUSES];

/** Cancellation lifecycle as returned in Order Details. */
export const ITHINK_CANCEL_STATUSES = [
  'Pending',
  'Approved',
  'Request Rejected',
  'Refunded',
] as const;

/** Page sizes accepted by Print Shipment Label. */
export const ITHINK_LABEL_PAGE_SIZES = ['A4', 'A5', 'A6'] as const;
export type IThinkLabelPageSize = (typeof ITHINK_LABEL_PAGE_SIZES)[number];

/**
 * Logging: never include these keys in request/response logs even at
 * trace level. The client masks them before emitting.
 */
export const ITHINK_SENSITIVE_KEYS = [
  'access_token',
  'secret_key',
] as const satisfies readonly string[];

/**
 * Warehouse approval lifecycle. Mirrors iThink's `status` field on the
 * Get Warehouse response; we surface this in the seller/franchise admin
 * panels so they know when their pickup address goes live.
 */
export const ITHINK_WAREHOUSE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type IThinkWarehouseStatus =
  (typeof ITHINK_WAREHOUSE_STATUS)[keyof typeof ITHINK_WAREHOUSE_STATUS];
