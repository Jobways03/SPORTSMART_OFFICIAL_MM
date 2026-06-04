import { Injectable, NotFoundException } from '@nestjs/common';

import { DefaultCourierGatewayResolver } from '../factories/courier-gateway.resolver';
import type {
  CancelShipmentResult,
  NdrActionResult,
  PrintLabelResult,
  TrackingSnapshotResult,
} from '../ports/outbound/courier-gateway.port';

const PARTNER = 'DELHIVERY';

/**
 * Phase 3 Delhivery wiring (2026-06-02) — stateless, AWB-keyed carrier
 * actions. The facade `create` path is stateless (it returns a random
 * shipmentId and persists no row), so these post-booking actions key on
 * the AWB rather than a facade shipment id. Each resolves the partner
 * adapter via the resolver (same pattern as CreateShipmentService) and
 * calls the real Delhivery integration.
 */
@Injectable()
export class CarrierActionsService {
  constructor(private readonly resolver: DefaultCourierGatewayResolver) {}

  /** Current tracking snapshot for one AWB. */
  async track(awb: string): Promise<TrackingSnapshotResult> {
    const map = await this.resolver.forPartner(PARTNER).track([awb]);
    const snap = map.get(awb);
    if (!snap) {
      throw new NotFoundException(`No tracking snapshot for AWB ${awb}`);
    }
    return snap;
  }

  /** Cancel a shipment (pre-pickup). */
  async cancel(awb: string): Promise<CancelShipmentResult> {
    return this.resolver.forPartner(PARTNER).cancelShipment(awb);
  }

  /** Print/label PDF URL for an AWB. */
  async label(awb: string): Promise<PrintLabelResult> {
    return this.resolver.forPartner(PARTNER).printLabel([awb]);
  }

  /** Apply a Delhivery NDR re-attempt (only the AWB is needed). */
  async ndrReattempt(awb: string): Promise<NdrActionResult> {
    return this.resolver.forPartner(PARTNER).reattempt({
      awb,
      date: '',
      time: '',
      address: '',
      mobile: '',
      addressType: 'HOME',
    });
  }

  /**
   * "RTO" for Delhivery. Delhivery's redesigned NDR API has NO explicit
   * RTO call (the partner auto-drives RTO once delivery retries exhaust),
   * so the closest actionable effect is to cancel the shipment — if it is
   * already picked up, Delhivery's automatic RTO handles the return leg.
   */
  async rto(awb: string): Promise<NdrActionResult> {
    const c = await this.resolver.forPartner(PARTNER).cancelShipment(awb);
    return {
      awb,
      success: c.success,
      message: c.success
        ? 'Delhivery has no explicit RTO API; shipment cancelled (carrier auto-RTO follows if already picked up).'
        : c.errorMessage ?? 'RTO via cancel failed',
    };
  }
}
