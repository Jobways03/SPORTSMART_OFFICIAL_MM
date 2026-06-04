import type {
  CreateShipmentPayload,
  CreateShipmentResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import type {
  ShadowfaxCreateMarketplaceRequest,
  ShadowfaxCreateOrderSuccess,
  ShadowfaxCreateWarehouseRequest,
  ShadowfaxProductLine,
} from '../dtos/shadowfax-create-shipment.dto';
import { SHADOWFAX_PARTNER_CODE } from '../shadowfax.constants';

/**
 * Translate between the carrier-neutral `CreateShipmentPayload`
 * (used by the courier-gateway port) and Shadowfax's create-order
 * body — and back again on the success response.
 *
 * Two product lines are supported:
 *   • marketplace  — `toShadowfaxRequest`           (rts_details)
 *   • warehouse    — `toShadowfaxWarehouseRequest`  (rto_details +
 *                                                    optional location_type)
 *
 * The response shape is identical between modes, so a single
 * `fromShadowfaxResponse` handles both.
 */

/** Options the adapter passes through to influence the mapping. */
export interface ToShadowfaxRequestOptions {
  /** Wire mode literal. */
  mode: 'marketplace';
  /**
   * Shadowfax-side seller/warehouse identifier echoed into
   * `pickup_details.unique_code`. Optional; falls back to the
   * canonical pickupAddressId when omitted.
   */
  sellerWarehouseCode?: string;
  /**
   * Storefront tracking URL template applied to the response. Default
   * `https://sportsmart.com/track/${awb}`.
   */
  trackingUrlTemplate?: (awb: string) => string;
}

/** Options for the warehouse-mode mapper. */
export interface ToShadowfaxWarehouseRequestOptions {
  /**
   * Shadowfax-side warehouse identifier echoed into both
   * `pickup_details.unique_code` and `rto_details.unique_code`.
   */
  warehouseCode?: string;
  /**
   * Optional drop-address classification. Docs spell the values
   * `"residential" | "Commercial"` (lowercase first, capital second).
   */
  locationType?: 'residential' | 'Commercial';
  trackingUrlTemplate?: (awb: string) => string;
}

/** Convert paise (BigInt) to a plain INR rupee number. */
function paiseToInr(paise: bigint | undefined): number {
  if (paise === undefined || paise === null) return 0;
  // We accept a small rounding error here vs. carrying BigInt to the
  // wire — Shadowfax's schema is `number` (not string) and rejects
  // BigInt. paise -> rupees is exact for any value <= Number.MAX_SAFE.
  return Number(paise) / 100;
}

function pincodeToNumber(pincode: string): number {
  // Pincodes are 6-digit numerics; canonical layer enforces the
  // shape. We `Number()` rather than `parseInt` to surface a clear
  // NaN if a non-numeric somehow slips through (caller will reject).
  return Number(pincode);
}

function computeVolumetricWeightGrams(dim?: {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}): number {
  if (!dim) return 0;
  const { lengthCm, widthCm, heightCm } = dim;
  if (!lengthCm || !widthCm || !heightCm) return 0;
  // Shadowfax: volumetric grams = (l*b*h in cm) / 5000 * 1000? No —
  // their formula is the standard courier volumetric divisor: kg =
  // l*b*h / 5000, then * 1000 to get grams.
  return Math.round((lengthCm * widthCm * heightCm * 1000) / 5000);
}

/**
 * Build the Shadowfax marketplace create-order request body from a
 * canonical `CreateShipmentPayload`.
 *
 * Decisions worth noting:
 *   • `client_order_id` is the canonical `subOrderId` (UUID). The
 *     payload also carries `orderId` for the parent order; we prefer
 *     `subOrderId` because Shadowfax dedupes on `client_order_id`
 *     and the parent may fan out to multiple sub-orders.
 *   • `rts_details` defaults to the same address block as
 *     `pickup_details`. The canonical payload exposes
 *     `returnAddressId` but not the address content; the M1 caller
 *     resolves return addresses upstream and passes the same shape.
 *   • Pincodes are NUMBERS — Shadowfax 400s on string-pincodes.
 */
export function toShadowfaxRequest(
  payload: CreateShipmentPayload,
  options: ToShadowfaxRequestOptions,
): ShadowfaxCreateMarketplaceRequest {
  void options.mode; // marketplace literal — kept for symmetry

  const codAmount = payload.cod ? paiseToInr(payload.codAmountPaise) : 0;
  const productValue = paiseToInr(payload.declaredValuePaise);
  const volumetric = computeVolumetricWeightGrams(payload.dimensionsCm);

  const uniqueCode =
    options.sellerWarehouseCode ?? payload.pickupAddressId;

  const pickupBlock = {
    name: payload.pickup.name,
    contact: payload.pickup.phone,
    address_line_1: payload.pickup.line1,
    ...(payload.pickup.line2 ? { address_line_2: payload.pickup.line2 } : {}),
    city: payload.pickup.city,
    state: payload.pickup.state,
    pincode: pincodeToNumber(payload.pickup.pincode),
    unique_code: uniqueCode,
  };

  const product_details: ShadowfaxProductLine[] = payload.items.map(
    (item) => ({
      sku_id: item.sku,
      sku_name: item.name,
      price: paiseToInr(item.unitValuePaise),
      additional_details: {
        quantity: item.quantity,
      },
    }),
  );

  return {
    order_type: 'marketplace',
    order_details: {
      client_order_id: payload.subOrderId,
      actual_weight: payload.weightGrams,
      volumetric_weight: volumetric,
      product_value: productValue,
      cod_amount: codAmount,
      payment_mode: payload.cod ? 'COD' : 'Prepaid',
      total_amount: productValue,
      order_service: 'regular',
    },
    customer_details: {
      name: payload.drop.name,
      contact: payload.drop.phone,
      address_line_1: payload.drop.line1,
      ...(payload.drop.line2 ? { address_line_2: payload.drop.line2 } : {}),
      city: payload.drop.city,
      state: payload.drop.state,
      pincode: pincodeToNumber(payload.drop.pincode),
    },
    pickup_details: pickupBlock,
    rts_details: {
      // Same address block; Shadowfax requires the full shape even
      // when it's identical to pickup.
      name: payload.pickup.name,
      contact: payload.pickup.phone,
      address_line_1: payload.pickup.line1,
      ...(payload.pickup.line2 ? { address_line_2: payload.pickup.line2 } : {}),
      city: payload.pickup.city,
      state: payload.pickup.state,
      pincode: pincodeToNumber(payload.pickup.pincode),
      unique_code: uniqueCode,
    },
    product_details,
  };
}

/**
 * Build the Shadowfax warehouse create-order request body from a
 * canonical `CreateShipmentPayload`. The shape mirrors the marketplace
 * body with two differences:
 *
 *   1. `order_type: "warehouse"`.
 *   2. The return-address block is keyed `rto_details` (return-to-
 *      origin) instead of `rts_details` (return-to-seller).
 *
 * `customer_details.location_type` is optional. Pass it via
 * `options.locationType`. Note the partner's exact casing:
 * `"residential"` (lowercase) | `"Commercial"` (capital C).
 */
export function toShadowfaxWarehouseRequest(
  payload: CreateShipmentPayload,
  options: ToShadowfaxWarehouseRequestOptions = {},
): ShadowfaxCreateWarehouseRequest {
  const codAmount = payload.cod ? paiseToInr(payload.codAmountPaise) : 0;
  const productValue = paiseToInr(payload.declaredValuePaise);
  const volumetric = computeVolumetricWeightGrams(payload.dimensionsCm);

  const uniqueCode = options.warehouseCode ?? payload.pickupAddressId;

  const pickupBlock = {
    name: payload.pickup.name,
    contact: payload.pickup.phone,
    address_line_1: payload.pickup.line1,
    ...(payload.pickup.line2 ? { address_line_2: payload.pickup.line2 } : {}),
    city: payload.pickup.city,
    state: payload.pickup.state,
    pincode: pincodeToNumber(payload.pickup.pincode),
    unique_code: uniqueCode,
  };

  const product_details: ShadowfaxProductLine[] = payload.items.map(
    (item) => ({
      sku_id: item.sku,
      sku_name: item.name,
      price: paiseToInr(item.unitValuePaise),
      additional_details: {
        quantity: item.quantity,
      },
    }),
  );

  return {
    order_type: 'warehouse',
    order_details: {
      client_order_id: payload.subOrderId,
      actual_weight: payload.weightGrams,
      volumetric_weight: volumetric,
      product_value: productValue,
      cod_amount: codAmount,
      payment_mode: payload.cod ? 'COD' : 'Prepaid',
      total_amount: productValue,
      order_service: 'regular',
    },
    customer_details: {
      name: payload.drop.name,
      contact: payload.drop.phone,
      address_line_1: payload.drop.line1,
      ...(payload.drop.line2 ? { address_line_2: payload.drop.line2 } : {}),
      city: payload.drop.city,
      state: payload.drop.state,
      pincode: pincodeToNumber(payload.drop.pincode),
      ...(options.locationType ? { location_type: options.locationType } : {}),
    },
    pickup_details: pickupBlock,
    // Warehouse-mode return block — same shape as rts_details, keyed
    // differently. We re-use the pickup address as the default RTO
    // target, matching the marketplace-mode behaviour.
    rto_details: {
      name: payload.pickup.name,
      contact: payload.pickup.phone,
      address_line_1: payload.pickup.line1,
      ...(payload.pickup.line2 ? { address_line_2: payload.pickup.line2 } : {}),
      city: payload.pickup.city,
      state: payload.pickup.state,
      pincode: pincodeToNumber(payload.pickup.pincode),
      unique_code: uniqueCode,
    },
    product_details,
  };
}

/**
 * Translate Shadowfax's create-order success envelope into the
 * canonical `CreateShipmentResult` the courier-gateway port emits.
 *
 * `labelUrl` is intentionally null — Shadowfax doesn't return a
 * label URL on create; the label-fetch flow is a separate endpoint
 * (`GET /v3/clients/orders/<id>/label` — wired in a later sprint).
 */
export function fromShadowfaxResponse(
  resp: ShadowfaxCreateOrderSuccess,
  opts: { subOrderId: string; trackingUrlTemplate?: (awb: string) => string } = {
    subOrderId: '',
  },
): CreateShipmentResult {
  const awb = resp.data.awb_number;
  const trackingUrl = (opts.trackingUrlTemplate ?? defaultTrackingUrl)(awb);
  void SHADOWFAX_PARTNER_CODE; // re-exported for symmetry with delhivery mapper
  return {
    subOrderId: opts.subOrderId || resp.data.client_order_id,
    success: true,
    awb,
    carrierOrderRef: String(resp.data.id),
    trackingUrl,
    // Shadowfax serves PDF labels via a separate endpoint; v1 leaves
    // this null and the label-fetch flow lands in the next sprint.
    labelUrl: undefined,
  };
}

function defaultTrackingUrl(awb: string): string {
  return `https://sportsmart.com/track/${awb}`;
}
