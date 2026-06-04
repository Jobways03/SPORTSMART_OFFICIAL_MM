import { Injectable, NotImplementedException } from '@nestjs/common';
import type { LogisticsErrorCode } from '@sportsmart/logistics-contracts';
import { ShadowfaxClient } from '../clients/shadowfax.client';
import type {
  CreateShipmentPayload,
  CreateShipmentResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  isShadowfaxCreateOrderSuccess,
  type ShadowfaxCreateMarketplaceRequest,
  type ShadowfaxCreateOrderResponse,
  type ShadowfaxCreateOrderSuccess,
  type ShadowfaxCreateWarehouseRequest,
} from '../dtos/shadowfax-create-shipment.dto';
import {
  fromShadowfaxResponse,
  toShadowfaxRequest,
  toShadowfaxWarehouseRequest,
} from '../mappers/shadowfax-shipment.mapper';
import { mapShadowfaxError, type MappedError } from '../mappers/shadowfax-error.mapper';
import { SHADOWFAX_PATHS } from '../shadowfax.constants';
import {
  isShadowfaxCancelResponse,
  type CanonicalCancelOutcome,
  type ShadowfaxCancelRequest,
  type ShadowfaxCancelResponse,
} from '../dtos/shadowfax-cancel.dto';
import {
  isShadowfaxUpdateOrderSuccess,
  type CanonicalOrderUpdate,
  type ShadowfaxUpdateOrderRequest,
  type ShadowfaxUpdateOrderResponse,
} from '../dtos/shadowfax-update-order.dto';

/**
 * Carrier-error envelope thrown when Shadowfax rejects a request.
 * The global exception filter unpacks `.code` into the RFC 7807
 * `code` field; callers can also catch and inspect `.retryable` /
 * `.originalAwbIfDuplicate` for IDEMPOTENT_REPLAY handling.
 *
 * Defined in this file rather than core/ because v1 only has one
 * caller. When a second adapter (Delhivery) needs it, promote into
 * `core/errors/carrier-error.ts`.
 */
export class CarrierError extends Error {
  readonly code: LogisticsErrorCode;
  readonly retryable: boolean;
  readonly originalAwbIfDuplicate?: string;
  readonly detail: string;

  constructor(mapped: MappedError) {
    super(mapped.detail);
    this.name = 'CarrierError';
    this.code = mapped.code;
    this.retryable = mapped.retryable;
    this.originalAwbIfDuplicate = mapped.originalAwbIfDuplicate;
    this.detail = mapped.detail;
  }
}

export interface CreateMarketplaceShipmentOptions {
  /** Echoed into pickup_details.unique_code if supplied. */
  sellerWarehouseCode?: string;
  /** Override the storefront tracking URL template. */
  trackingUrlTemplate?: (awb: string) => string;
}

export interface CreateWarehouseShipmentOptions {
  /**
   * Echoed into both `pickup_details.unique_code` and
   * `rto_details.unique_code` if supplied.
   */
  warehouseCode?: string;
  /**
   * Optional drop-address classification. Docs spell the values
   * `"residential" | "Commercial"` exactly — case-sensitive.
   */
  locationType?: 'residential' | 'Commercial';
  /** Override the storefront tracking URL template. */
  trackingUrlTemplate?: (awb: string) => string;
}

/**
 * Order-management surface for Shadowfax. Covers:
 *   • marketplace forward create
 *   • warehouse forward create
 *   • order update (delivery / pickup / return / order / status)
 *   • cancel (with three canonical outcomes)
 *
 * Reverse pickup is intentionally NOT covered — SportsMart does not
 * use Shadowfax reverse pickup. See `shadowfax-pickup.service.ts`
 * for the rationale + the Apiary reference for whoever turns it on
 * later.
 */
@Injectable()
export class ShadowfaxOrderService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Book a marketplace forward shipment with Shadowfax.
   *
   * Flow:
   *   1. Translate canonical -> Shadowfax wire body.
   *   2. POST /v3/clients/orders/.
   *   3. On HTTP 4xx/5xx OR HTTP 200+message="Failure" — translate
   *      via mapShadowfaxError, throw CarrierError.
   *      Special-case: IDEMPOTENT_REPLAY is non-retryable but the
   *      caller usually wants the original AWB. v1 throws and the
   *      `originalAwbIfDuplicate` field on CarrierError carries the
   *      existing AWB; once the tracking API is wired, the service
   *      will fetch the original order and return it as a normal
   *      CreateShipmentResult (TODO).
   *   4. On success — translate via fromShadowfaxResponse, return.
   */
  async createMarketplaceShipment(
    req: CreateShipmentPayload,
    opts: CreateMarketplaceShipmentOptions = {},
  ): Promise<CreateShipmentResult> {
    const body: ShadowfaxCreateMarketplaceRequest = toShadowfaxRequest(req, {
      mode: 'marketplace',
      sellerWarehouseCode: opts.sellerWarehouseCode,
      trackingUrlTemplate: opts.trackingUrlTemplate,
    });

    const response = await this.client.post<
      ShadowfaxCreateMarketplaceRequest,
      ShadowfaxCreateOrderResponse
    >(SHADOWFAX_PATHS.CREATE_ORDER, body, {
      // Internal audit key; Shadowfax dedupes on client_order_id
      // regardless of this header.
      idempotencyKey: req.subOrderId,
    });

    return this.finaliseCreateResponse(req, response.status, response.body, opts.trackingUrlTemplate);
  }

  /**
   * Book a warehouse forward shipment with Shadowfax.
   *
   * Identical request flow + response shape to marketplace; the only
   * differences are on the wire (order_type literal + rto_details
   * key + optional location_type). The response mapper is shared.
   */
  async createWarehouseShipment(
    req: CreateShipmentPayload,
    opts: CreateWarehouseShipmentOptions = {},
  ): Promise<CreateShipmentResult> {
    const body: ShadowfaxCreateWarehouseRequest = toShadowfaxWarehouseRequest(req, {
      warehouseCode: opts.warehouseCode,
      locationType: opts.locationType,
      trackingUrlTemplate: opts.trackingUrlTemplate,
    });

    const response = await this.client.post<
      ShadowfaxCreateWarehouseRequest,
      ShadowfaxCreateOrderResponse
    >(SHADOWFAX_PATHS.CREATE_ORDER, body, {
      idempotencyKey: req.subOrderId,
    });

    return this.finaliseCreateResponse(req, response.status, response.body, opts.trackingUrlTemplate);
  }

  /**
   * Cancel a Shadowfax shipment.
   *
   * Accepts either an AWB or a `client_order_id` as `requestId`. The
   * canonical outcome is one of three positive states (CANCELLED,
   * CANCEL_QUEUED, ALREADY_CANCELLED). All other partner responses
   * raise `CarrierError` via `mapShadowfaxError`.
   *
   * Flow:
   *   1. Validate reason is non-empty (partner rejects blank).
   *   2. POST /v3/clients/orders/cancel/ with `{ request_id,
   *      cancel_remarks }`.
   *   3. Parse `responseCode` + `responseMsg`:
   *        • 200 + "marked as cancelled"     → CANCELLED
   *        • 304                              → CANCEL_QUEUED
   *        • msg "already in its
   *          cancellation phase"              → ALREADY_CANCELLED
   *        • anything else                    → throw CarrierError
   *   4. Even when HTTP is 200, the partner can surface a failure in
   *      the body — we route via mapShadowfaxError.
   */
  async cancelShipment(
    awbOrClientOrderId: string,
    reason: string,
  ): Promise<CanonicalCancelOutcome> {
    const trimmedReason = reason?.trim() ?? '';
    if (!trimmedReason) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'cancel reason is required and may not be empty.',
        retryable: false,
      });
    }
    const requestId = awbOrClientOrderId?.trim();
    if (!requestId) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'cancel requestId is required (AWB or client_order_id).',
        retryable: false,
      });
    }

    const body: ShadowfaxCancelRequest = {
      request_id: requestId,
      cancel_remarks: trimmedReason,
    };

    const response = await this.client.post<
      ShadowfaxCancelRequest,
      ShadowfaxCancelResponse | unknown
    >(SHADOWFAX_PATHS.CANCEL, body, {
      idempotencyKey: `cancel:${requestId}`,
    });

    // Non-2xx — translate the partner status to a CarrierError.
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapShadowfaxError(response.status, response.body));
    }

    if (!isShadowfaxCancelResponse(response.body)) {
      throw new CarrierError(mapShadowfaxError(response.status, response.body));
    }

    const { responseCode, responseMsg } = response.body;
    const lowerMsg = responseMsg.toLowerCase();

    if (responseCode === 200 && lowerMsg.includes('marked as cancelled')) {
      return { state: 'CANCELLED' };
    }
    if (responseCode === 304) {
      return { state: 'CANCEL_QUEUED' };
    }
    if (lowerMsg.includes('already in its cancellation phase')) {
      return { state: 'ALREADY_CANCELLED' };
    }

    // Anything else — Invalid state, Multiple Orders, Pincode Updated,
    // Invalid AWB, Unable to cancel, etc. The 200-with-failure-body
    // case is the most common; mapShadowfaxError routes by message.
    throw new CarrierError(mapShadowfaxError(400, response.body));
  }

  /**
   * Amend a live Shadowfax shipment without re-booking.
   *
   * Accepts canonical change fields and translates them to the partner
   * wire shape. At least one mutation must be present; we surface a
   * VALIDATION_FAILED CarrierError if the caller passes an empty
   * payload (avoids a wasted partner round-trip).
   */
  async updateOrder(awb: string, changes: CanonicalOrderUpdate): Promise<void> {
    const trimmedAwb = awb?.trim();
    if (!trimmedAwb) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'updateOrder awb is required.',
        retryable: false,
      });
    }

    const body = buildUpdateOrderBody(trimmedAwb, changes);

    // Empty body = caller bug. Refuse rather than burning a partner call.
    if (!hasAnyUpdate(body)) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          'updateOrder requires at least one of delivery/pickup/return/order/statusUpdate.',
        retryable: false,
      });
    }

    const response = await this.client.post<
      ShadowfaxUpdateOrderRequest,
      ShadowfaxUpdateOrderResponse
    >(SHADOWFAX_PATHS.ORDER_UPDATE, body, {
      idempotencyKey: `update:${trimmedAwb}:${Date.now()}`,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapShadowfaxError(response.status, response.body));
    }

    if (!isShadowfaxUpdateOrderSuccess(response.body)) {
      // Partner surfaced a failure inside a 200 body — route via
      // the error mapper, treating it as a 400 for classification.
      throw new CarrierError(mapShadowfaxError(400, response.body));
    }
  }

  /* ── Pending operations — schemas TBD ─────────────────────────── */

  /**
   * TODO: Get order details (used to resolve original AWB on
   * IDEMPOTENT_REPLAY).
   * Endpoint: GET /v3/clients/orders/<client_order_id>/; response
   * schema pending.
   */
  async getOrderDetails(_clientOrderId: string): Promise<unknown> {
    throw new NotImplementedException(
      `[SHADOWFAX] getOrderDetails pending — endpoint GET ` +
        `/v3/clients/orders/<client_order_id>/; schema TBD.`,
    );
  }

  /* ── Private helpers ─────────────────────────────────────────── */

  /**
   * Common tail for both `createMarketplaceShipment` and
   * `createWarehouseShipment`. The wire response shape is identical
   * between modes so we can share the success / error branching.
   */
  private finaliseCreateResponse(
    req: CreateShipmentPayload,
    status: number,
    bodyRaw: unknown,
    trackingUrlTemplate: ((awb: string) => string) | undefined,
  ): CreateShipmentResult {
    if (status < 200 || status >= 300) {
      throw new CarrierError(mapShadowfaxError(status, bodyRaw));
    }

    if (isShadowfaxCreateOrderSuccess(bodyRaw)) {
      return fromShadowfaxResponse(bodyRaw as ShadowfaxCreateOrderSuccess, {
        subOrderId: req.subOrderId,
        trackingUrlTemplate,
      });
    }

    // HTTP 2xx but Shadowfax surfaced a Failure envelope.
    throw new CarrierError(mapShadowfaxError(status, bodyRaw));
  }
}

/* ─── Module-private helpers ───────────────────────────────────────── */

/** Convert paise (BigInt) to a plain INR rupee number. */
function paiseToInr(paise: bigint | undefined): number | undefined {
  if (paise === undefined || paise === null) return undefined;
  return Number(paise) / 100;
}

function pincodeToNumberOptional(pincode: string | undefined): number | undefined {
  if (!pincode) return undefined;
  const n = Number(pincode);
  return Number.isFinite(n) ? n : undefined;
}

function buildUpdateOrderBody(
  awb: string,
  changes: CanonicalOrderUpdate,
): ShadowfaxUpdateOrderRequest {
  const body: ShadowfaxUpdateOrderRequest = {
    awb_numbers: awb,
  };

  if (changes.delivery) {
    const d = changes.delivery;
    const delivery: NonNullable<ShadowfaxUpdateOrderRequest['delivery_details']> = {};
    if (d.contact !== undefined) delivery.contact = d.contact;
    if (d.alternateContact !== undefined) delivery.alternate_contact = d.alternateContact;
    if (d.address !== undefined) delivery.customer_address = d.address;
    const pincode = pincodeToNumberOptional(d.pincode);
    if (pincode !== undefined) delivery.pincode = pincode;
    if (d.latitude !== undefined) delivery.latitude = d.latitude;
    if (d.longitude !== undefined) delivery.longitude = d.longitude;
    if (Object.keys(delivery).length > 0) body.delivery_details = delivery;
  }

  if (changes.pickup) {
    const p = changes.pickup;
    const pickup: NonNullable<ShadowfaxUpdateOrderRequest['pickup_details']> = {};
    if (p.contact !== undefined) pickup.contact = p.contact;
    if (p.address !== undefined) pickup.customer_address = p.address;
    const pincode = pincodeToNumberOptional(p.pincode);
    if (pincode !== undefined) pickup.pincode = pincode;
    if (p.latitude !== undefined) pickup.latitude = p.latitude;
    if (p.longitude !== undefined) pickup.longitude = p.longitude;
    if (Object.keys(pickup).length > 0) body.pickup_details = pickup;
  }

  if (changes.return) {
    const r = changes.return;
    const ret: NonNullable<ShadowfaxUpdateOrderRequest['return_details']> = {};
    if (r.contact !== undefined) ret.contact = r.contact;
    if (r.address !== undefined) ret.return_address = r.address;
    const pincode = pincodeToNumberOptional(r.pincode);
    if (pincode !== undefined) ret.pincode = pincode;
    if (r.latitude !== undefined) ret.latitude = r.latitude;
    if (r.longitude !== undefined) ret.longitude = r.longitude;
    if (Object.keys(ret).length > 0) body.return_details = ret;
  }

  if (changes.order) {
    const o = changes.order;
    const order: NonNullable<ShadowfaxUpdateOrderRequest['order_details']> = {};
    const cod = paiseToInr(o.codAmountPaise);
    if (cod !== undefined) order.cod_amount = cod;
    if (o.ewayBillNumber !== undefined) order.eway_bill_number = o.ewayBillNumber;
    if (o.returnEwayBillNumber !== undefined) order.return_eway_bill_number = o.returnEwayBillNumber;
    if (o.invoiceNumber !== undefined) order.invoice_number = o.invoiceNumber;
    if (o.actualWeightGrams !== undefined) order.actual_weight = o.actualWeightGrams;
    if (o.volumetricWeightGrams !== undefined) order.volumetric_weight = o.volumetricWeightGrams;
    if (Object.keys(order).length > 0) body.order_details = order;
  }

  if (changes.statusUpdate) {
    body.status_update = { status: changes.statusUpdate };
  }

  return body;
}

function hasAnyUpdate(body: ShadowfaxUpdateOrderRequest): boolean {
  return Boolean(
    body.delivery_details ||
      body.pickup_details ||
      body.return_details ||
      body.order_details ||
      body.status_update,
  );
}
