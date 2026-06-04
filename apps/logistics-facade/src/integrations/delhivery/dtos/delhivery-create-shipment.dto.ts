/**
 * Delhivery create-shipment wire shapes. Sourced from the create.json
 * spec at one.delhivery.com (B2C Shipment Manifestation API) — field
 * names match Delhivery's snake_case exactly. The mapper layer (see
 * `mappers/delhivery-shipment.mapper.ts`) translates between this and
 * the carrier-neutral `CreateShipmentPayload` from the port.
 *
 * Endpoint: `POST /api/cmu/create.json`.
 * Wire format: `Content-Type: application/x-www-form-urlencoded`,
 *              body = `format=json&data=<URL_ENCODED_JSON>`.
 *
 * NOTE: Delhivery's create endpoint accepts a top-level `shipments`
 * array — even when you only want to book one shipment. The array
 * shape is preserved here so a future batch-create / MPS call can
 * reuse the DTO unchanged.
 *
 * Quirks worth remembering:
 *   • Money fields (`cod_amount`, `total_amount`) are INR rupees as
 *     NUMBERS, not paise. Two-decimal precision.
 *   • Weight is GRAMS as a number (Delhivery is one of the few who
 *     uses grams directly rather than kg).
 *   • Pincodes are integers (`pin`, `return_pin`).
 *   • `payment_mode` is case-sensitive (`"Prepaid" | "COD" | "Pickup" | "REPL"`).
 *   • `pickup_location.name` MUST exactly match a warehouse registered
 *     in the Delhivery One panel (case + space sensitive).
 *   • Failures arrive HTTP 200 with `success: false` and an error in
 *     `packages[].remarks` or top-level `error` / `rmk`.
 */

/* ─── Enumerations ─────────────────────────────────────────────────── */

/**
 * Forward = Prepaid | COD. Reverse pickup = Pickup. Replacement
 * (exchange flow) = REPL. Case-sensitive on the wire.
 */
export type DelhiveryPaymentMode = 'Prepaid' | 'COD' | 'Pickup' | 'REPL';

/** Service tier. Defaults to Surface when omitted. */
export type DelhiveryShippingMode = 'Surface' | 'Express';

/** Address classification — used for last-mile routing heuristics. */
export type DelhiveryAddressType = 'home' | 'office';

/** `F` = next-day priority lane; `D` = standard ground service. */
export type DelhiveryTransportSpeed = 'F' | 'D';

/** Marker literal for multi-piece shipments. */
export type DelhiveryShipmentType = 'MPS';

/* ─── Request body ─────────────────────────────────────────────────── */

/**
 * One shipment record inside the `shipments` array of a create
 * request. Required fields are non-optional; everything else maps to
 * an optional partner-side field. The mapper layer is responsible
 * for keeping mode-specific fields aligned (e.g. `cod_amount` only
 * set when `payment_mode === 'COD'`).
 */
export interface DelhiveryShipment {
  /* ── Required ── */

  /** Consignee name. */
  name: string;
  /** Caller-side order id; echoed back as `refnum` in the response. */
  order: string;
  /** Consignee phone. */
  phone: string;
  /** Consignee street address (single string; Delhivery doesn't split lines). */
  add: string;
  /** Consignee pincode as integer. */
  pin: number;
  /** Payment / direction discriminator. See `DelhiveryPaymentMode`. */
  payment_mode: DelhiveryPaymentMode;

  /* ── Optional consignee fields ── */

  city?: string;
  state?: string;
  /** Default `"India"`; `"BD"` for Bangladesh (mandatory for BD). */
  country?: string;
  address_type?: DelhiveryAddressType;

  /* ── Optional shipment metadata ── */

  /** Weight in grams. */
  weight?: number;
  /** Dimensions in cm. */
  shipment_height?: number;
  shipment_width?: number;
  shipment_length?: number;
  shipping_mode?: DelhiveryShippingMode;
  fragile_shipment?: boolean;
  dangerous_good?: boolean;
  plastic_packaging?: boolean;
  transport_speed?: DelhiveryTransportSpeed;

  /* ── Payments / commerce ── */

  /** Required when `payment_mode === 'COD'`. INR rupees. */
  cod_amount?: number;
  /** INR rupees. Declared / invoice value. */
  total_amount?: number;
  /** Free-form product description. */
  products_desc?: string;
  /** Total quantity as a string (Delhivery accepts string here). */
  quantity?: string;
  /** E-waybill number — mandatory when shipment value >= ₹50,000. */
  ewbn?: string;
  /** HSN code for the eway-bill. */
  hsn_code?: string;

  /* ── Waybill ── */

  /**
   * Pre-fetched AWB. SPS (single-piece) may omit and Delhivery
   * auto-assigns; MPS REQUIRES one per box.
   */
  waybill?: string;

  /* ── Seller snapshot ── */

  seller_name?: string;
  seller_add?: string;
  seller_inv?: string;
  /** Seller GSTIN printed on the label (only sent when verified upstream). */
  seller_gst_tin?: string;

  /* ── Return / RTO fields ── */

  return_name?: string;
  return_address?: string;
  return_city?: string;
  return_state?: string;
  return_country?: string;
  return_pin?: number;
  return_phone?: string;

  /* ── MPS (Multi-Piece Shipment) extras ── */

  /** Literal `"MPS"`. Identifies the row as part of a multi-piece set. */
  shipment_type?: DelhiveryShipmentType;
  /** Master waybill — same on every box of the set. */
  master_id?: string;
  /** Sum of all COD amounts across the set (0 if prepaid). */
  mps_amount?: number;
  /** Total boxes in the set (master + children). */
  mps_children?: number;
}

/**
 * The full wire body Delhivery's create.json endpoint expects.
 * Wrapped at the client layer into
 * `format=json&data=<urlencoded JSON>`.
 *
 * `pickup_location.name` MUST exactly match a warehouse registered
 * in the Delhivery One panel — case + space sensitive. A typo here
 * is the #1 cause of "ClientWarehouse Matching Query Does Not Exist".
 */
export interface DelhiveryCreateShipmentRequest {
  shipments: DelhiveryShipment[];
  pickup_location: { name: string };
}

/* ─── Response body ────────────────────────────────────────────────── */

/**
 * Per-package row in the create.json response. Matched to a request
 * shipment via `refnum` (which echoes the `order` field).
 *
 * VERIFY shape against first live response — built from the docs
 * pattern and historical Delhivery API responses.
 */
export interface DelhiveryCreateShipmentPackage {
  /** AWB allocated by Delhivery; absent on failure. */
  waybill?: string;
  /** `"Success" | "Fail"` per package. */
  status?: string;
  /** Echoes our `order`. */
  refnum?: string;
  /** Per-package error remark (single string, or array of strings). */
  remarks?: string[] | string;
  /** Sort-code Delhivery resolved for the drop pincode. */
  sort_code?: string;
  /** Returned payment echo. */
  payment?: string;
}

/**
 * Envelope returned by `POST /api/cmu/create.json`.
 *
 * VERIFY shape against first live response; built from docs pattern.
 * Treat fields liberally as optional/unknown until we have a confirmed
 * sample in the repo.
 */
export interface DelhiveryCreateShipmentResponse {
  packages?: DelhiveryCreateShipmentPackage[];
  success?: boolean;
  package_count?: number;
  cod_count?: number;
  prepaid_count?: number;
  cod_amount?: number;
  cash_pickups_count?: number;
  cash_pickups_amount?: number;
  upload_wbn?: string;
  rmk?: string;
  error?: unknown;
}

/* ─── Type guards ──────────────────────────────────────────────────── */

/**
 * Treat as success when:
 *   • envelope `success` isn't explicitly false, AND
 *   • there is at least one package, AND
 *   • every package has status `"Success"` (or unset, which Delhivery
 *     historically left implicit) AND carries a waybill.
 */
export function isDelhiveryCreateShipmentSuccess(
  resp: DelhiveryCreateShipmentResponse,
): boolean {
  if (resp.success === false) return false;
  if (!resp.packages || resp.packages.length === 0) return false;
  return resp.packages.every(
    (p) => (p.status ?? 'Success') === 'Success' && !!p.waybill,
  );
}
