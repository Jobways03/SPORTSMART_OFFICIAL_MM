import { Injectable, NotImplementedException } from '@nestjs/common';
import type { CanonicalTrackingTimeline } from '@sportsmart/logistics-contracts';
import {
  CarrierCapabilityError,
  type CancelShipmentResult,
  type CourierAdapterMeta,
  type CourierGatewayPort,
  type CreateShipmentPayload,
  type CreateShipmentResult,
  type NdrActionResult,
  type PrintLabelResult,
  type RegisterPickupRequest,
  type RegisterPickupResult,
  type ServiceabilityCheckResult,
  type TrackingSnapshotResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import { ShadowfaxOrderService } from '../services/shadowfax-order.service';
import { ShadowfaxTrackingService } from '../services/shadowfax-tracking.service';
import { ShadowfaxNdrService } from '../services/shadowfax-ndr.service';
import {
  SHADOWFAX_DISPLAY_NAME,
  SHADOWFAX_PARTNER_CODE,
} from '../shadowfax.constants';
import type { CanonicalCancelOutcome } from '../dtos/shadowfax-cancel.dto';
import type { CanonicalOrderUpdate } from '../dtos/shadowfax-update-order.dto';

/**
 * Optional discriminator carried on `CreateShipmentPayload` to pick
 * the Shadowfax product line. Mirrors the `FulfilmentMode` enum on
 * the contracts package; redeclared here as a structural alias so
 * the port stays generic.
 */
type FulfilmentModeHint = 'MARKETPLACE' | 'WAREHOUSE' | undefined;

/**
 * Shadowfax's implementation of `CourierGatewayPort`.
 *
 * v2 scope:
 *   • createShipment — picks marketplace vs warehouse off the
 *     payload's optional `fulfilmentMode` field. Defaults to
 *     MARKETPLACE when the field is missing.
 *   • track / trackMany — pulls a single or bulk timeline via the
 *     v4 tracking endpoints.
 *   • cancel — wraps the cancel endpoint, returning a canonical
 *     three-state outcome (CANCELLED / CANCEL_QUEUED /
 *     ALREADY_CANCELLED).
 *   • updateOrder — issues a partial mutation against an existing
 *     shipment (delivery / pickup / return / order / status).
 *
 * Still pending (left as NotImplementedException with TODO
 * comments naming the partner endpoint):
 *   • registerPickup (no public endpoint)
 *   • checkServiceability
 *   • printLabel (separate /label.pdf flow)
 *   • reattempt
 *
 * Reverse pickup is intentionally NOT IMPLEMENTED. SportsMart does
 * not use Shadowfax reverse pickup. If this changes, implement
 * against the Shadowfax Reverse Pickup API documented at
 * https://sfxreversepickupsellerdelivery.docs.apiary.io/
 */
@Injectable()
export class ShadowfaxCourierAdapter implements CourierGatewayPort {
  readonly meta: CourierAdapterMeta = {
    partner: SHADOWFAX_PARTNER_CODE,
    displayName: SHADOWFAX_DISPLAY_NAME,
    region: 'IN',
  };

  constructor(
    private readonly orderService: ShadowfaxOrderService,
    private readonly trackingService: ShadowfaxTrackingService,
    private readonly ndrService: ShadowfaxNdrService,
  ) {}

  /**
   * Forward create. Picks the partner product line based on the
   * payload's optional `fulfilmentMode` field:
   *   • `WAREHOUSE`  → ShadowfaxOrderService.createWarehouseShipment
   *   • everything else (default) → createMarketplaceShipment
   */
  createShipment(payload: CreateShipmentPayload): Promise<CreateShipmentResult> {
    const mode = (payload as CreateShipmentPayload & {
      fulfilmentMode?: FulfilmentModeHint;
    }).fulfilmentMode;

    if (mode === 'WAREHOUSE') {
      return this.orderService.createWarehouseShipment(payload);
    }
    return this.orderService.createMarketplaceShipment(payload);
  }

  /**
   * TODO: Endpoint POST /v3/clients/orders/serviceability/.
   * Schema pending — leaves NotImplementedException so the resolver
   * can still wire the adapter.
   */
  checkServiceability(_pincode: string): Promise<ServiceabilityCheckResult> {
    throw new NotImplementedException(
      `[SHADOWFAX] checkServiceability pending — endpoint POST ` +
        `/v3/clients/orders/serviceability/; schema TBD.`,
    );
  }

  /**
   * TODO: Shadowfax does not expose a self-serve pickup-registration
   * endpoint; onboarding goes through their account-management team.
   * The adapter will surface `CarrierCapabilityError` once the
   * policy is confirmed.
   */
  registerPickup(_req: RegisterPickupRequest): Promise<RegisterPickupResult> {
    throw new NotImplementedException(
      `[SHADOWFAX] registerPickup pending — no public endpoint; ` +
        `decide CarrierCapabilityError vs partner-program API.`,
    );
  }

  /**
   * Cancel a shipment. The canonical port returns `CancelShipmentResult`
   * (`{ awb, success, errorMessage? }`) so we collapse the partner's
   * three positive outcomes into a `success: true` result and stash
   * the canonical `state` in `errorMessage` for callers that care.
   *
   * Use `cancel()` instead of `cancelShipment()` for the richer
   * `CanonicalCancelOutcome` surface that distinguishes
   * CANCELLED / CANCEL_QUEUED / ALREADY_CANCELLED.
   */
  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    const outcome = await this.cancel(awb, 'Request cancelled by SportsMart');
    return {
      awb,
      success: true,
      errorMessage:
        outcome.state === 'CANCELLED' ? undefined : `state=${outcome.state}`,
    };
  }

  /**
   * Cancel with a caller-supplied reason. Returns the canonical
   * three-state outcome so the call site can distinguish between an
   * immediate cancel, a queued cancel (in-transit), and an idempotent
   * replay.
   */
  cancel(
    awbOrClientOrderId: string,
    reason: string,
  ): Promise<CanonicalCancelOutcome> {
    return this.orderService.cancelShipment(awbOrClientOrderId, reason);
  }

  /**
   * Apply a partial update to an existing Shadowfax shipment.
   */
  updateOrder(awb: string, changes: CanonicalOrderUpdate): Promise<void> {
    return this.orderService.updateOrder(awb, changes);
  }

  /**
   * TODO: Endpoint GET /v3/clients/orders/<id>/label.pdf.
   * Schema TBD; need to confirm PDF vs presigned URL behaviour.
   */
  printLabel(_awbs: string[]): Promise<PrintLabelResult> {
    throw new NotImplementedException(
      `[SHADOWFAX] printLabel pending — endpoint GET ` +
        `/v3/clients/orders/<id>/label.pdf; schema TBD.`,
    );
  }

  /**
   * Bulk-track surface required by the carrier-neutral port. Adapts
   * the Shadowfax bulk-tracking response (canonical timelines) to
   * the port's `TrackingSnapshotResult` shape.
   *
   * For richer access to the canonical timeline (events list with
   * partner labels + raw payloads), call `trackMany` instead.
   */
  async track(awbs: string[]): Promise<Map<string, TrackingSnapshotResult>> {
    const timelines = await this.trackingService.getOrdersTracking(awbs);
    const out = new Map<string, TrackingSnapshotResult>();
    for (const [awb, timeline] of timelines) {
      out.set(awb, toPortSnapshot(timeline));
    }
    return out;
  }

  /**
   * Single-AWB tracking returning the canonical timeline.
   */
  trackSingle(awb: string): Promise<CanonicalTrackingTimeline> {
    return this.trackingService.getOrderTracking(awb);
  }

  /**
   * Bulk tracking returning canonical timelines keyed by AWB.
   */
  trackMany(awbs: string[]): Promise<Map<string, CanonicalTrackingTimeline>> {
    return this.trackingService.getOrdersTracking(awbs);
  }

  /**
   * TODO: NDR reattempt. Endpoint POST /v3/clients/orders/<id>/reattempt/.
   * Schema TBD.
   */
  reattempt(_input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    throw new NotImplementedException(
      `[SHADOWFAX] reattempt pending — endpoint POST ` +
        `/v3/clients/orders/<id>/reattempt/; schema TBD.`,
    );
  }

  /**
   * Shadowfax does not expose an RTO-initiate endpoint — surface as
   * a CarrierCapabilityError so the caller can fall back gracefully.
   */
  async initiateRto(input: { awb: string; remark: string }): Promise<NdrActionResult> {
    // `ndrService.initiateRto` is typed `never` — calling it always
    // throws CarrierCapabilityError. The `await` makes it a rejected
    // promise as required by the port signature.
    this.ndrService.initiateRto(input);
    // Unreachable; satisfies the return-type checker.
    throw new CarrierCapabilityError(SHADOWFAX_DISPLAY_NAME, 'initiateRto');
  }

  /**
   * Reverse-pickup create. NOT IMPLEMENTED — SportsMart does not use
   * Shadowfax reverse pickup. If this changes, implement against the
   * Shadowfax Reverse Pickup API documented at
   * https://sfxreversepickupsellerdelivery.docs.apiary.io/
   */
  createReverse(_payload: CreateShipmentPayload): Promise<CreateShipmentResult> {
    throw new NotImplementedException(
      'SportsMart does not use Shadowfax reverse pickup. To enable, ' +
        'implement against the Shadowfax Reverse Pickup API documented ' +
        'at https://sfxreversepickupsellerdelivery.docs.apiary.io/',
    );
  }

  /**
   * Reverse-pickup tracking. NOT IMPLEMENTED — same rationale as
   * `createReverse`. Reference Apiary doc above.
   */
  getReverseOrderTracking(_awb: string): Promise<CanonicalTrackingTimeline> {
    throw new NotImplementedException(
      'SportsMart does not use Shadowfax reverse pickup. To enable, ' +
        'implement against the Shadowfax Reverse Pickup API documented ' +
        'at https://sfxreversepickupsellerdelivery.docs.apiary.io/',
    );
  }
}

/* ─── Private helpers ──────────────────────────────────────────────── */

/**
 * Adapt a `CanonicalTrackingTimeline` to the port's
 * `TrackingSnapshotResult`. Lossy on purpose — the port doesn't
 * carry the customer-tracking URL nor the partner status labels;
 * those are available via `trackSingle` / `trackMany`.
 */
function toPortSnapshot(timeline: CanonicalTrackingTimeline): TrackingSnapshotResult {
  return {
    awb: timeline.awb,
    partner: timeline.partner,
    direction: 'forward',
    currentNormalizedStatus: timeline.currentStatus,
    events: timeline.events.map((event) => ({
      partnerStatusCode: event.partnerStatusCode,
      normalizedStatus: event.normalizedStatus,
      location: event.location ?? undefined,
      remark: event.remarks,
      eventAt: new Date(event.occurredAt),
    })),
  };
}
