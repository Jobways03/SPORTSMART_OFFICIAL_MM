import { Injectable } from '@nestjs/common';
import type { LogisticsErrorCode } from '@sportsmart/logistics-contracts';
import { AppLoggerService } from '../../../bootstrap/logging/app-logger.service';
import { DelhiveryClient } from '../clients/delhivery.client';
import type {
  CancelShipmentResult,
  CreateShipmentPayload,
  CreateShipmentResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  isDelhiveryCreateShipmentSuccess,
  type DelhiveryCreateShipmentRequest,
  type DelhiveryCreateShipmentResponse,
} from '../dtos/delhivery-create-shipment.dto';
import type {
  DelhiveryCancelRequest,
  DelhiveryEditOrCancelResponse,
  DelhiveryUpdateShipmentRequest,
} from '../dtos/delhivery-cancel.dto';
import type {
  DelhiveryEwaybillUpdateRequest,
  DelhiveryEwaybillUpdateResponse,
} from '../dtos/delhivery-ewaybill.dto';
import type {
  DelhiveryRvpCreateRequest,
  DelhiveryRvpCreateResponse,
} from '../dtos/delhivery-rvp-qc.dto';
import {
  fromDelhiveryCreateResponse,
  toDelhiveryShipment,
} from '../mappers/delhivery-shipment.mapper';
import {
  mapDelhiveryError,
  type MappedError,
} from '../mappers/delhivery-error.mapper';
import { DELHIVERY_PATHS, DELHIVERY_DISPLAY_NAME } from '../delhivery.constants';

/**
 * Carrier-error envelope thrown when Delhivery rejects a request.
 * Local for now — when a third adapter needs the same shape, promote
 * into `core/errors/carrier-error.ts`.
 *
 * Shape kept identical to the Shadowfax `CarrierError` so the global
 * exception filter can unpack either without branching.
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

/** Caller-supplied options for the create-shipment surface. */
export interface CreateDelhiveryShipmentOptions {
  /**
   * Warehouse name registered in the Delhivery One panel — used for
   * `pickup_location.name` in the wire body. MUST match exactly
   * (case + space sensitive). The adapter sources this from
   * `DelhiveryConfig.defaultPickupWarehouseName` or, eventually,
   * from a `Seller.warehouseCode` lookup on the canonical request.
   */
  pickupWarehouseName: string;
  /** Override the storefront tracking URL template. */
  trackingUrlTemplate?: (awb: string) => string;
}

/** Fields callers may patch on an existing shipment via `/api/p/edit`. */
export interface UpdateDelhiveryShipmentChanges {
  paymentMode?: 'COD' | 'Pre-paid';
  /** COD amount in INR; required when flipping to COD. */
  codAmount?: number;
  consigneeName?: string;
  consigneePhone?: string;
  consigneeAddress?: string;
  productsDesc?: string;
  weightGrams?: number;
  dimensionsCm?: {
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
  };
}

/**
 * Order-management surface for Delhivery — create + cancel + update +
 * e-way bill update + RVP QC 3.0 reverse-shipment create.
 *
 * One service per partner-side concern so the adapter (which composes
 * them all) stays small and unit-tests can fake one service without
 * dragging in the rest.
 *
 * Pattern mirrors apps/logistics-facade/src/integrations/shadowfax/services/shadowfax-order.service.ts.
 */
@Injectable()
export class DelhiveryOrderService {
  constructor(
    private readonly client: DelhiveryClient,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Book a forward shipment with Delhivery.
   *
   * Flow:
   *   1. Translate canonical -> Delhivery wire body via
   *      `toDelhiveryShipment` (single-shipment, SPS).
   *   2. POST `/api/cmu/create.json` with `contentType: 'form'`
   *      — Delhivery's create endpoint requires the legacy form-style
   *      body `format=json&data=<urlencoded JSON>`. The client knows
   *      how to wrap it.
   *   3. On HTTP 4xx/5xx — `mapDelhiveryError` -> throw `CarrierError`.
   *   4. On HTTP 200 with `success: false` or no AWB-bearing package
   *      — `mapDelhiveryError(200, body)` -> throw `CarrierError`.
   *   5. On success — `fromDelhiveryCreateResponse` -> return.
   *
   * Delhivery dedupes on (client, `order`), so passing `subOrderId`
   * as `order` makes retries inherently idempotent — re-sends return
   * "Duplicate order" with the original AWB inline, which the error
   * mapper surfaces as `IDEMPOTENT_REPLAY` + `originalAwbIfDuplicate`.
   */
  async createShipment(
    req: CreateShipmentPayload,
    opts: CreateDelhiveryShipmentOptions,
  ): Promise<CreateShipmentResult> {
    if (!opts.pickupWarehouseName || !opts.pickupWarehouseName.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          'Delhivery createShipment requires a pickupWarehouseName matching ' +
          'a warehouse registered in the Delhivery One panel.',
        retryable: false,
      });
    }

    const body: DelhiveryCreateShipmentRequest = toDelhiveryShipment(req, {
      pickupWarehouseName: opts.pickupWarehouseName,
    });

    const response = await this.client.post<
      DelhiveryCreateShipmentRequest,
      DelhiveryCreateShipmentResponse | unknown
    >(DELHIVERY_PATHS.CREATE_SHIPMENT, body, {
      contentType: 'form',
      idempotencyKey: req.subOrderId,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const envelope = response.body as DelhiveryCreateShipmentResponse;
    if (!isObject(envelope) || !isDelhiveryCreateShipmentSuccess(envelope)) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    return fromDelhiveryCreateResponse(envelope, {
      subOrderId: req.subOrderId,
      trackingUrlTemplate: opts.trackingUrlTemplate,
    });
  }

  /**
   * Cancel a booked shipment.
   *
   * Delhivery uses `POST /api/p/edit` with body
   *   `{ waybill: <awb>, cancellation: "true" }` (the literal string
   * "true"). Behaviour depends on current status:
   *   • Manifested + cancel -> stays Manifested with status_type UD.
   *   • In-Transit + cancel -> stays In-Transit with status_type RT
   *                            (returns to origin).
   *   • Scheduled  + cancel -> Canceled with status_type CN.
   *
   * Idempotency: a second cancel returns "Already cancelled" which
   * the error mapper treats as IDEMPOTENT_REPLAY; we surface success
   * for those.
   */
  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    if (!awb || !awb.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'cancelShipment requires an AWB.',
        retryable: false,
      });
    }

    const body: DelhiveryCancelRequest = {
      waybill: awb,
      cancellation: 'true',
    };

    const response = await this.client.post<
      DelhiveryCancelRequest,
      DelhiveryEditOrCancelResponse | unknown
    >(DELHIVERY_PATHS.EDIT_OR_CANCEL, body, {
      contentType: 'json',
      idempotencyKey: `cancel-${awb}`,
    });

    // Idempotent cancel: a shipment that is ALREADY cancelled is the desired
    // end state, not a failure. Delhivery reports this with a remark like
    // "Shipment has been cancelled." — sometimes on a non-2xx — which the error
    // mapper would otherwise classify as PARTNER_REJECTED and throw (HTTP 500),
    // wrongly blocking an order-cancel that re-cancels the same AWB. Treat it as
    // success. Guard against the genuine "cannot cancel — already picked up /
    // manifested" case, which MUST still fail so the caller falls back to RTO.
    const responseText = stringifyBody(response.body);
    const alreadyCancelled =
      /(has been cancelled|already cancelled|shipment\s+is\s+cancelled)/i.test(
        responseText,
      ) &&
      !/(cannot|can\s*not|can't|not\s+allowed|not\s+in\b|unable|picked\s*up|manifest)/i.test(
        responseText,
      );
    if (alreadyCancelled) {
      return {
        awb,
        success: true,
        errorMessage: 'Shipment was already cancelled at Delhivery.',
      };
    }

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const envelope = response.body as DelhiveryEditOrCancelResponse;
    if (
      isObject(envelope) &&
      typeof envelope.status === 'string' &&
      /success/i.test(envelope.status)
    ) {
      return { awb, success: true };
    }

    // Map specifically — IDEMPOTENT_REPLAY ("already cancelled") =>
    // surface as success, everything else throws.
    try {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    } catch (err) {
      if (err instanceof CarrierError && err.code === 'IDEMPOTENT_REPLAY') {
        return { awb, success: true, errorMessage: err.detail };
      }
      throw err;
    }
  }

  /**
   * Patch consignee / shipment-detail fields on an existing AWB.
   * Uses `POST /api/p/edit` — same endpoint as cancel, but sends the
   * field diff instead of `cancellation: "true"`.
   *
   * Only Manifested / In-Transit / Pending shipments are editable
   * (forward); reverse pickups must be Scheduled. Delivered, RTO,
   * DTO, LOST, and Closed are rejected — the error mapper surfaces
   * those as INVALID_STATE.
   */
  async updateShipment(
    awb: string,
    changes: UpdateDelhiveryShipmentChanges,
  ): Promise<{ awb: string; success: boolean; errorMessage?: string }> {
    if (!awb || !awb.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'updateShipment requires an AWB.',
        retryable: false,
      });
    }
    if (changes.paymentMode === 'COD' && changes.codAmount === undefined) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          'updateShipment to COD requires a codAmount — Delhivery 400s without it.',
        retryable: false,
      });
    }

    const body: DelhiveryUpdateShipmentRequest = {
      waybill: awb,
      pt: changes.paymentMode,
      cod: changes.codAmount,
      name: changes.consigneeName,
      phone: changes.consigneePhone,
      add: changes.consigneeAddress,
      products_desc: changes.productsDesc,
      gm: changes.weightGrams,
      shipment_height: changes.dimensionsCm?.heightCm,
      shipment_width: changes.dimensionsCm?.widthCm,
      shipment_length: changes.dimensionsCm?.lengthCm,
    };

    const response = await this.client.post<
      DelhiveryUpdateShipmentRequest,
      DelhiveryEditOrCancelResponse | unknown
    >(DELHIVERY_PATHS.EDIT_OR_CANCEL, body, {
      contentType: 'json',
      idempotencyKey: `update-${awb}-${Date.now()}`,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const envelope = response.body as DelhiveryEditOrCancelResponse;
    if (
      isObject(envelope) &&
      typeof envelope.status === 'string' &&
      /success/i.test(envelope.status)
    ) {
      return { awb, success: true };
    }
    throw new CarrierError(mapDelhiveryError(response.status, response.body));
  }

  /**
   * Attach / update the GST e-way bill number for a high-value AWB.
   *
   * `PUT /api/rest/ewaybill/{waybill}/` with body
   *   `{ data: [{ dcn: <invoice_no>, ewbn: <ewb_no> }] }`.
   *
   * Required for shipments with declared value > ₹50,000 so the lorry
   * receipt can be inspected by GST officers in-transit.
   */
  async updateEwaybill(
    awb: string,
    dcn: string,
    ewbn: string,
  ): Promise<{ awb: string; success: boolean; errorMessage?: string }> {
    if (!awb || !awb.trim() || !dcn || !ewbn) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'updateEwaybill requires awb + dcn (invoice) + ewbn (ewaybill).',
        retryable: false,
      });
    }

    const body: DelhiveryEwaybillUpdateRequest = {
      data: [{ dcn, ewbn }],
    };

    // Delhivery wants PUT — appended path `{awb}/` per spec.
    const path = `${DELHIVERY_PATHS.EWAYBILL}${encodeURIComponent(awb)}/`;
    const response = await this.client.put<
      DelhiveryEwaybillUpdateRequest,
      DelhiveryEwaybillUpdateResponse | unknown
    >(path, body, {
      contentType: 'json',
      idempotencyKey: `ewaybill-${awb}-${dcn}`,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const envelope = response.body as DelhiveryEwaybillUpdateResponse;
    if (
      isObject(envelope) &&
      (typeof envelope.status !== 'string' ||
        /success/i.test(envelope.status))
    ) {
      return { awb, success: true };
    }
    throw new CarrierError(mapDelhiveryError(response.status, response.body));
  }

  /**
   * Reverse-shipment create with parametric QC (RVP QC 3.0).
   *
   * Shares the create endpoint with forward shipments — distinguished
   * by `payment_mode: "Pickup"`, `qc_type: "param"`, and the
   * `custom_qc` array. Max 2 items per shipment, max 6 questions per
   * item.
   *
   * NOTE: SportsMart does NOT currently run reverse pickups — this
   * surface is implemented for completeness and emits a clear warning
   * on call.
   */
  async createRvpQc(
    req: DelhiveryRvpCreateRequest,
    opts: { idempotencyKey?: string } = {},
  ): Promise<CreateShipmentResult> {
    this.logger.warn(
      `[${DELHIVERY_DISPLAY_NAME}] RVP QC 3.0 implemented but currently unused ` +
        `by SportsMart per business decision (no return / reverse flow). ` +
        `Proceeding with create.`,
    );

    if (
      !req.pickup_location?.name ||
      !req.pickup_location.name.trim() ||
      !req.shipments?.length
    ) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          'createRvpQc requires a pickup_location.name and at least one shipment row.',
        retryable: false,
      });
    }
    // Enforce RVP QC 3.0 limits before paying the network cost.
    for (const s of req.shipments) {
      if (s.custom_qc.length > 2) {
        throw new CarrierError({
          code: 'VALIDATION_FAILED',
          detail: 'RVP QC 3.0 caps custom_qc at 2 items per shipment.',
          retryable: false,
        });
      }
      for (const q of s.custom_qc) {
        if (q.questions.length > 6) {
          throw new CarrierError({
            code: 'VALIDATION_FAILED',
            detail: 'RVP QC 3.0 caps questions at 6 per item.',
            retryable: false,
          });
        }
      }
    }

    const response = await this.client.post<
      DelhiveryRvpCreateRequest,
      DelhiveryRvpCreateResponse | unknown
    >(DELHIVERY_PATHS.CREATE_SHIPMENT, req, {
      contentType: 'form',
      idempotencyKey: opts.idempotencyKey ?? req.shipments[0]?.order,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const envelope = response.body as DelhiveryRvpCreateResponse;
    if (!isObject(envelope) || !isDelhiveryCreateShipmentSuccess(envelope)) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    return fromDelhiveryCreateResponse(envelope, {
      subOrderId: req.shipments[0]?.order ?? 'rvp',
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Best-effort flatten of a response body to a searchable string. */
function stringifyBody(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
