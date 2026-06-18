import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryMethod } from '@prisma/client';

import { LogisticsFacadeClient } from '../../../../integrations/logistics-facade/clients/logistics-facade.client';
import { buildOrderReference } from '../../application/order-reference.util';
import {
  type CancelShipmentResult,
  type CourierAdapterMeta,
  type CourierGatewayPort,
  type CreateShipmentRequest,
  type CreateShipmentResult,
  type DomainAddress,
  type NdrActionResult,
  type PrintLabelResult,
  type RegisterPickupRequest,
  type RegisterPickupResult,
  type ServiceabilityResult,
  type TrackingSnapshot,
} from '../../application/ports/outbound/courier-gateway.port';

const FACADE_CREATE_PATH = '/api/v1/internal/shipments';
// Phase 3 Delhivery wiring (2026-06-02) — stateless, AWB-keyed carrier-action
// routes on the facade (track / label / cancel / ndr-reattempt / rto).
const FACADE_AWB_BASE = '/api/v1/internal/shipments/awb';

/**
 * Delhivery courier adapter. Delegates booking to the logistics-facade
 * (`POST /internal/shipments`), which calls Delhivery's real cmu/create
 * API and returns the AWB + label.
 *
 * Phase 2 (2026-06-02): `createShipment` is live.
 * Phase 3 (2026-06-02): `track` / `printLabel` / `cancelShipment` /
 * `reattempt` / `initiateRto` are now wired through the facade's
 * AWB-keyed carrier-action routes (`/internal/shipments/awb/:awb/*`).
 * Delhivery has no explicit RTO API, so `initiateRto` aliases to cancel.
 */
@Injectable()
export class DelhiveryCourierAdapter implements CourierGatewayPort {
  private readonly logger = new Logger(DelhiveryCourierAdapter.name);

  readonly meta: CourierAdapterMeta = {
    method: 'DELHIVERY' as DeliveryMethod,
    carrier: 'delhivery',
  };

  constructor(private readonly facade: LogisticsFacadeClient) {}

  /**
   * Delhivery serves most of India; the real per-pincode check lands with
   * the facade serviceability route. Permissive default so allocation /
   * checkout aren't blocked.
   */
  async checkServiceability(pincode: string): Promise<ServiceabilityResult> {
    return {
      pincode,
      serviceable: true,
      codAvailable: true,
      prepaidAvailable: true,
      carriers: [{ carrier: 'delhivery', prepaid: true, cod: true, pickup: true }],
    };
  }

  /**
   * Pickup/warehouse registration is owned by the logistics-partner flow
   * (Delhivery client-warehouse create), so this is a passthrough.
   */
  async registerPickup(req: RegisterPickupRequest): Promise<RegisterPickupResult> {
    return {
      pickupAddressId: `delhivery:${req.ownerType.toLowerCase()}:${req.ownerId}`,
      approvalStatus: 'APPROVED',
      remark: 'Delhivery pickup warehouse is registered via the logistics-partner flow.',
    };
  }

  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult> {
    const s = req.shipment;
    const drop = toAddressSnapshot(s.shipping);
    const cod = (s.paymentMode ?? '').toLowerCase() === 'cod';

    // Human-readable label reference (the scannable "order" barcode). Shared
    // helper so the custom label generator prints the EXACT same value Delhivery
    // booked (see order-reference.util.ts). "<orderNumber>-<tag>"; deterministic
    // per sub-order so re-booking stays idempotent. Direction-aware: reverse
    // pickups get an `RVP-` prefix so they don't collide with the forward
    // shipment's order id in Delhivery's (client, order) dedup.
    const orderReference = buildOrderReference(
      s.orderNumber,
      req.subOrderId,
      req.direction,
    );

    // Paise are sent as strings on the wire; the facade's z.coerce.bigint()
    // accepts them. Delhivery books against the configured pickup warehouse,
    // so `pickup` is only contract-shape — reuse drop as a valid placeholder.
    const facadeReq = {
      orderId: req.subOrderId,
      subOrderId: req.subOrderId,
      orderReference,
      ...(s.sellerName ? { sellerName: s.sellerName } : {}),
      ...(s.sellerAddress ? { sellerAddress: s.sellerAddress } : {}),
      ...(s.sellerGstin ? { sellerGstin: s.sellerGstin } : {}),
      ...(s.pickupWarehouseName ? { pickupWarehouseName: s.pickupWarehouseName } : {}),
      pickup: drop,
      drop,
      items: s.products.map((p) => ({
        sku: (p.sku && p.sku.trim()) || p.name.slice(0, 64) || 'ITEM',
        name: p.name,
        quantity: p.quantity,
        unitValuePaise: rupeesToPaise(p.unitPrice),
      })),
      weightGrams: Math.max(1, Math.round((s.weightKg ?? 0) * 1000)),
      dimensions: {
        lengthCm: s.dimensions.length,
        widthCm: s.dimensions.width,
        heightCm: s.dimensions.height,
      },
      declaredValuePaise: rupeesToPaise(s.totalAmount),
      cod,
      ...(cod ? { codAmountPaise: rupeesToPaise(s.codAmount ?? s.totalAmount) } : {}),
      fragile: false,
      // forward (normal delivery) vs reverse (customer return pickup). The
      // facade routes 'reverse' to Delhivery's RVP create. Defaults to forward.
      direction: req.direction ?? s.direction ?? 'forward',
    };

    let res: { status: number; body: any };
    try {
      res = await this.facade.post<typeof facadeReq, any>(FACADE_CREATE_PATH, facadeReq, {
        idempotencyKey: req.subOrderId,
      });
    } catch (err) {
      this.logger.error(
        `Delhivery booking call failed for sub-order ${req.subOrderId}: ${(err as Error)?.message}`,
      );
      return {
        subOrderId: req.subOrderId,
        success: false,
        carrier: 'delhivery',
        errorMessage: (err as Error)?.message ?? 'logistics-facade unreachable',
      };
    }

    const data = (res.body && (res.body.data ?? res.body)) || {};
    const ok =
      res.status >= 200 && res.status < 300 && data.status === 'BOOKED' && !!data.awb;
    if (ok) {
      this.logger.log(
        `Delhivery shipment booked for sub-order ${req.subOrderId} — AWB ${data.awb}`,
      );
    } else {
      this.logger.warn(
        `Delhivery booking not confirmed for sub-order ${req.subOrderId} (facade ${res.status})`,
      );
    }

    return {
      subOrderId: req.subOrderId,
      success: ok,
      awb: data.awb ?? undefined,
      carrier: 'delhivery',
      trackingUrl: data.trackingUrl ?? undefined,
      orderRefnum: data.carrierOrderRef ?? undefined,
      errorMessage: ok ? undefined : `Delhivery booking failed (facade ${res.status})`,
    };
  }

  /**
   * Phase 3 (2026-06-02) — fetch the label/manifest PDF URL from the facade
   * (`GET /awb/:awb/label`). Throws if Delhivery has not produced a label yet
   * (freshly-booked AWBs may 404 until the carrier registers them); callers
   * fall back to the stored label/tracking URL.
   */
  async printLabel(awbs: string[]): Promise<PrintLabelResult> {
    const awb = awbs[0];
    if (!awb) throw new Error('printLabel: no AWB supplied');
    let res: { status: number; body: any };
    try {
      res = await this.facade.get<any>(
        `${FACADE_AWB_BASE}/${encodeURIComponent(awb)}/label`,
      );
    } catch (err) {
      throw new Error(
        `Delhivery label fetch failed for ${awb}: ${(err as Error)?.message}`,
      );
    }
    const d = (res.body && (res.body.data ?? res.body)) || {};
    if (res.status < 200 || res.status >= 300 || !d.fileUrl) {
      throw new Error(
        `Delhivery label not available for ${awb} (facade ${res.status})`,
      );
    }
    return { fileUrl: d.fileUrl };
  }

  /**
   * Phase 3 — on-demand tracking via the facade (`GET /awb/:awb/track`).
   * Maps the facade TrackingSnapshotResult → the API TrackingSnapshot shape.
   * A non-2xx (e.g. 404 = AWB not yet registered carrier-side) skips that AWB
   * rather than throwing, so a batch poll degrades gracefully.
   */
  async track(awbs: string[]): Promise<Map<string, TrackingSnapshot>> {
    const out = new Map<string, TrackingSnapshot>();
    for (const awb of awbs) {
      let res: { status: number; body: any };
      try {
        res = await this.facade.get<any>(
          `${FACADE_AWB_BASE}/${encodeURIComponent(awb)}/track`,
        );
      } catch (err) {
        this.logger.warn(
          `Delhivery track failed for AWB ${awb}: ${(err as Error)?.message}`,
        );
        continue;
      }
      if (res.status < 200 || res.status >= 300) continue;
      const d = (res.body && (res.body.data ?? res.body)) || {};
      if (!d.currentNormalizedStatus && !d.awb) continue;
      const events = Array.isArray(d.events) ? d.events : [];
      out.set(awb, {
        awb: d.awb ?? awb,
        carrier: 'Delhivery',
        direction: d.direction === 'reverse' ? 'reverse' : 'forward',
        currentStatus: d.currentNormalizedStatus ?? '',
        rawCurrentStatus: d.currentNormalizedStatus ?? '',
        expectedDelivery: d.expectedDeliveryAt
          ? new Date(d.expectedDeliveryAt)
          : undefined,
        scans: events.map((e: any) => ({
          status: e.normalizedStatus ?? '',
          rawStatus: e.normalizedStatus ?? '',
          rawStatusCode: e.partnerStatusCode ?? '',
          scanLocation: e.location ?? '',
          remark: e.remark ?? '',
          scanAt: e.eventAt ? new Date(e.eventAt) : new Date(),
        })),
      });
    }
    return out;
  }

  /** Phase 3 — cancel a Delhivery shipment by AWB via the facade. */
  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    let res: { status: number; body: any };
    try {
      res = await this.facade.post<Record<string, never>, any>(
        `${FACADE_AWB_BASE}/${encodeURIComponent(awb)}/cancel`,
        {},
        { idempotencyKey: `cancel-${awb}` },
      );
    } catch (err) {
      return {
        awb,
        success: false,
        errorMessage: (err as Error)?.message ?? 'logistics-facade unreachable',
      };
    }
    const d = (res.body && (res.body.data ?? res.body)) || {};
    const ok = res.status >= 200 && res.status < 300 && d.success === true;
    if (ok) return { awb, success: true };

    // Defensive idempotency: if the carrier reports the shipment is ALREADY
    // cancelled (even via a non-2xx problem-details body), that's the desired
    // end state — treat it as success so re-cancelling an already-cancelled AWB
    // doesn't block the order cancel. The facade also normalises this; we guard
    // here too. Excludes the genuine "cannot cancel — already picked up /
    // manifested" case, which must keep failing so the caller falls back to RTO.
    let bodyText: string;
    try {
      bodyText = JSON.stringify(res.body ?? '');
    } catch {
      bodyText = String(res.body);
    }
    const alreadyCancelled =
      /(has been cancelled|already cancelled|shipment\s+is\s+cancelled)/i.test(bodyText) &&
      !/(cannot|can\s*not|can't|not\s+allowed|not\s+in\b|unable|picked\s*up|manifest)/i.test(bodyText);
    if (alreadyCancelled) {
      return {
        awb,
        success: true,
        errorMessage: 'Shipment was already cancelled at Delhivery.',
      };
    }

    return {
      awb,
      success: false,
      errorMessage: d.errorMessage ?? `Delhivery cancel failed (facade ${res.status})`,
    };
  }

  /** Phase 3 — NDR re-attempt via the facade (Delhivery uses only the AWB). */
  async reattempt(input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    let res: { status: number; body: any };
    try {
      res = await this.facade.post<Record<string, never>, any>(
        `${FACADE_AWB_BASE}/${encodeURIComponent(input.awb)}/ndr-reattempt`,
        {},
        { idempotencyKey: `ndr-reattempt-${input.awb}` },
      );
    } catch (err) {
      return {
        awb: input.awb,
        success: false,
        message: (err as Error)?.message ?? 'logistics-facade unreachable',
      };
    }
    const d = (res.body && (res.body.data ?? res.body)) || {};
    const ok = res.status >= 200 && res.status < 300 && d.success === true;
    return {
      awb: input.awb,
      success: ok,
      message:
        d.message ??
        (ok ? 'NDR re-attempt accepted' : `NDR re-attempt failed (facade ${res.status})`),
    };
  }

  /**
   * Phase 3 — RTO via the facade. Delhivery has no explicit RTO API, so the
   * facade route aliases to cancel (carrier auto-RTO follows post-pickup);
   * `message` conveys that.
   */
  async initiateRto(input: { awb: string; remark: string }): Promise<NdrActionResult> {
    let res: { status: number; body: any };
    try {
      res = await this.facade.post<Record<string, never>, any>(
        `${FACADE_AWB_BASE}/${encodeURIComponent(input.awb)}/rto`,
        {},
        { idempotencyKey: `rto-${input.awb}` },
      );
    } catch (err) {
      return {
        awb: input.awb,
        success: false,
        message: (err as Error)?.message ?? 'logistics-facade unreachable',
      };
    }
    const d = (res.body && (res.body.data ?? res.body)) || {};
    const ok = res.status >= 200 && res.status < 300 && d.success === true;
    return {
      awb: input.awb,
      success: ok,
      message: d.message ?? (ok ? 'RTO/cancel accepted' : `RTO failed (facade ${res.status})`),
    };
  }
}

function toAddressSnapshot(a: DomainAddress) {
  return {
    name: a.name,
    phone: a.phone,
    email: a.email,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    country: a.country ?? 'IN',
  };
}

/** Rupees decimal string → integer paise string (the wire form for PaiseAmount). */
function rupeesToPaise(rupees: string | undefined): string {
  const n = Number(rupees ?? '0');
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(Math.round(n * 100));
}
