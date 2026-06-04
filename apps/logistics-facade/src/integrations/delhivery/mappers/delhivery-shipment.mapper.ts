import type {
  CreateShipmentPayload,
  CreateShipmentResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import type {
  DelhiveryCreateShipmentRequest,
  DelhiveryCreateShipmentResponse,
  DelhiveryShipment,
} from '../dtos/delhivery-create-shipment.dto';
import { DELHIVERY_PARTNER_CODE } from '../delhivery.constants';

/**
 * Translate between the carrier-neutral `CreateShipmentPayload`
 * (used by the courier-gateway port) and Delhivery's `create.json`
 * wire body — and back again on the success response.
 *
 * Kept as a pure module of functions — no DI, no logging. Pure
 * mappers are unit-testable without bringing up the Nest container.
 *
 * Pattern mirrors apps/logistics-facade/src/integrations/shadowfax/mappers/shadowfax-shipment.mapper.ts.
 */

/** Caller-supplied options influencing the create-request mapping. */
export interface ToDelhiveryShipmentOptions {
  /**
   * Warehouse name registered in the Delhivery One panel. MUST match
   * exactly (case + space sensitive) — Delhivery returns
   * "ClientWarehouseMatchingQueryDoesNotExist" on the tiniest typo.
   */
  pickupWarehouseName: string;
}

/** Caller-supplied options for the response mapping. */
export interface FromDelhiveryResponseOptions {
  /** Canonical sub-order id; echoed straight onto the result. */
  subOrderId: string;
  /** Override the storefront tracking URL template. */
  trackingUrlTemplate?: (awb: string) => string;
}

/* ─── Number helpers ───────────────────────────────────────────────── */

/**
 * Convert paise (BigInt) to a plain INR rupee number. Returns 0 when
 * the input is undefined so the wire body always carries a number
 * (Delhivery 400s on `null`).
 */
function paiseToInr(paise: bigint | undefined | null): number {
  if (paise === undefined || paise === null) return 0;
  return Number(paise) / 100;
}

function pincodeToNumber(pincode: string): number {
  // Pincodes are 6-digit numerics; canonical layer enforces shape.
  // Use Number() so a non-numeric surfaces as NaN and Delhivery's
  // own validation catches it loudly instead of silently dropping.
  return Number(pincode);
}

/* ─── Request mapping ──────────────────────────────────────────────── */

/**
 * Build the Delhivery create-shipment body from a canonical
 * `CreateShipmentPayload`. Single-shipment (SPS) by default — MPS
 * support is a follow-up (see TODO at bottom).
 *
 * Decisions worth noting:
 *   • `payment_mode` maps from canonical `cod` boolean. The canonical
 *     payload's `direction === 'reverse'` would map to `"Pickup"` but
 *     v1 ships forward-only; reverse is a TODO.
 *   • `pickup_location.name` is caller-supplied — the adapter pulls
 *     it from config (or, eventually, a Seller.warehouseCode lookup).
 *   • Money: canonical paise (BigInt) -> INR rupees (number). The
 *     canonical->wire conversion is lossless for values <= MAX_SAFE.
 *   • Weight stays in grams (Delhivery is one of the few partners
 *     that uses grams natively).
 *   • Dimensions are passed through in cm.
 *   • `total_amount` is the sum of all per-item unit values * qty —
 *     i.e. the declared invoice value. Falls back to
 *     `declaredValuePaise` when items are absent.
 *   • `return_*` fields are filled when the canonical payload carries
 *     a separate return address. v1 forwards aren't doing this yet —
 *     RTO defaults to the pickup address on Delhivery's side.
 */
export function toDelhiveryShipment(
  payload: CreateShipmentPayload,
  opts: ToDelhiveryShipmentOptions,
): DelhiveryCreateShipmentRequest {
  const paymentMode: DelhiveryShipment['payment_mode'] = payload.cod
    ? 'COD'
    : 'Prepaid';

  const declaredInr = paiseToInr(payload.declaredValuePaise);
  const itemsTotalInr = (payload.items ?? []).reduce(
    (acc, it) => acc + paiseToInr(it.unitValuePaise) * (it.quantity ?? 1),
    0,
  );
  const totalAmount = itemsTotalInr > 0 ? itemsTotalInr : declaredInr;

  const quantityTotal = (payload.items ?? []).reduce(
    (acc, it) => acc + (it.quantity ?? 0),
    0,
  );

  const productsDesc =
    (payload.items ?? [])
      .map((it) => `${it.quantity ?? 1} x ${it.name ?? it.sku}`)
      .join(', ') || 'Sportsmart shipment';

  const shipment: DelhiveryShipment = {
    // Required
    name: payload.drop.name,
    // The scannable "order" barcode on the label. Prefer the human-readable
    // reference ("<orderNumber>-<tag>", built API-side) so warehouse staff can
    // match a parcel to the order; fall back to the sub-order id. Delhivery
    // dedupes bookings on this value, so it must be unique + deterministic per
    // sub-order — both forms satisfy that.
    order: payload.orderReference ?? payload.subOrderId,
    phone: payload.drop.phone,
    add: [payload.drop.line1, payload.drop.line2].filter(Boolean).join(', '),
    pin: pincodeToNumber(payload.drop.pincode),
    payment_mode: paymentMode,

    // Optional consignee
    city: payload.drop.city,
    state: payload.drop.state,
    country: payload.drop.country ?? 'India',

    // Shipment metadata
    weight: payload.weightGrams,
    shipment_length: payload.dimensionsCm?.lengthCm,
    shipment_width: payload.dimensionsCm?.widthCm,
    shipment_height: payload.dimensionsCm?.heightCm,

    // Commerce
    total_amount: totalAmount,
    products_desc: productsDesc,
    quantity: quantityTotal > 0 ? String(quantityTotal) : undefined,

    // TODO: source from canonical when added — fragile flag is on
    // `CreateShipmentRequest` (contract) but not on `CreateShipmentPayload`
    // (port). When the port grows the flag, plumb it through here.
    // fragile_shipment: payload.fragile,

    // Merchant identity for the label's "Seller" box (informational only — the
    // parcel still picks up from + returns to the registered pickup warehouse,
    // NOT this address). Falls back to the warehouse's own details when the
    // caller doesn't supply them.
    seller_name: payload.sellerName,
    seller_add: payload.sellerAddress,
    // Seller GSTIN — the caller only supplies this when the GST is verified
    // upstream, so we never print an unconfirmed number on the label.
    seller_gst_tin: payload.sellerGstin,
    // TODO: seller_inv when a per-shipment seller invoice number is wired.
    // seller_inv: payload.sellerInvoiceNumber,

    // TODO: source from canonical when added — ewbn + hsn_code apply
    // when declared value >= ₹50k. Surface from order metadata.
    // ewbn: payload.ewayBillNumber,
    // hsn_code: payload.items?.[0]?.hsn,
  };

  // COD amount only when COD; Delhivery silently drops mismatched
  // cod_amount but rejects when COD with no amount.
  if (payload.cod) {
    shipment.cod_amount = paiseToInr(payload.codAmountPaise);
  }

  // Return / RTO block. The canonical `CreateShipmentPayload` doesn't
  // carry an explicit return-address payload (only a returnAddressId),
  // so we leave `return_*` unset for forward bookings — Delhivery
  // defaults to the pickup address. When the port grows a
  // `returnAddress` snapshot, wire it here.
  // TODO: source from canonical when added —
  //   return_name, return_address, return_city, return_state,
  //   return_country, return_pin, return_phone.

  return {
    shipments: [shipment],
    pickup_location: { name: opts.pickupWarehouseName },
  };
}

/* ─── Response mapping ─────────────────────────────────────────────── */

/**
 * Translate Delhivery's create-shipment success envelope into the
 * canonical `CreateShipmentResult`. Picks the first `Success` package
 * (SPS shipments only emit one); MPS will need a fan-out variant.
 *
 * `labelUrl` is intentionally null — Delhivery serves the label via
 * a separate endpoint (`/api/p/packing_slip`).
 *
 * `trackingUrl` defaults to Delhivery's public consumer tracker. The
 * exact host is best-guess until verified with a real AWB; override
 * via `opts.trackingUrlTemplate` to point at the SportsMart storefront
 * tracker.
 */
export function fromDelhiveryCreateResponse(
  resp: DelhiveryCreateShipmentResponse,
  opts: FromDelhiveryResponseOptions,
): CreateShipmentResult {
  void DELHIVERY_PARTNER_CODE; // exported for symmetry with the Shadowfax mapper

  const firstSuccess =
    (resp.packages ?? []).find(
      (p) => (p.status ?? 'Success') === 'Success' && !!p.waybill,
    ) ?? (resp.packages ?? [])[0];

  const awb = firstSuccess?.waybill;
  const refnum = firstSuccess?.refnum ?? opts.subOrderId;
  const trackingUrl = awb
    ? (opts.trackingUrlTemplate ?? defaultTrackingUrl)(awb)
    : undefined;

  return {
    subOrderId: opts.subOrderId,
    success: !!awb,
    awb,
    // Delhivery doesn't issue a separate order ref — the refnum
    // (which echoes our `order`) is the only handle.
    carrierOrderRef: refnum,
    trackingUrl,
    labelUrl: undefined,
  };
}

function defaultTrackingUrl(awb: string): string {
  // Delhivery's public consumer tracker is PATH-based. The old `/track/?awb=`
  // query form 404s; the correct deep-link is `/track/package/<awb>`.
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}
