import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';

import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
  type TrackingSnapshot,
} from '../ports/outbound/courier-gateway.port';

/**
 * Carrier-agnostic ingest: take a tracking snapshot the resolver
 * produced, write the latest courier state into our SubOrder row,
 * and emit any state-machine effects (delivered_at, return_window
 * start, exception-queue routing).
 *
 * Called by:
 *   * `IThinkTrackingPollerCron` once per cron tick, per AWB.
 *   * The admin "refresh tracking" button (on-demand).
 *
 * The use case is deliberately small — domain effects beyond field
 * writes (commission scheduling, customer notification) ride on
 * `SUB_ORDER_DELIVERED` / `SUB_ORDER_EXCEPTION` events the orders
 * module emits when the fulfillmentStatus actually changes.
 */
@Injectable()
export class IngestTrackingUpdateUseCase {
  private readonly logger = new Logger(IngestTrackingUpdateUseCase.name);

  constructor(
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly resolver: CourierGatewayResolver,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Drain a list of AWBs through the iThink gateway and persist any
   * status changes. Returns the count of SubOrder rows touched —
   * caller logs / reports per cron tick.
   */
  async ingestForIThink(awbs: string[]): Promise<{ updated: number; missing: number }> {
    if (awbs.length === 0) return { updated: 0, missing: 0 };
    const gateway = this.resolver.forMethod('ITHINK_LOGISTICS');
    const snapshots = await gateway.track(awbs);

    let updated = 0;
    let missing = 0;
    for (const [awb, snapshot] of snapshots) {
      const subOrder = await this.prisma.subOrder.findFirst({
        where: { ithinkAwb: awb },
        select: { id: true, fulfillmentStatus: true },
      });
      if (!subOrder) {
        missing += 1;
        this.logger.warn(`Tracking update for unknown AWB ${awb} — orphan?`);
        continue;
      }

      await this.applySnapshot(subOrder.id, snapshot);
      updated += 1;
    }
    return { updated, missing };
  }

  /**
   * Apply a snapshot to a SubOrder. Updates the courier-side fields
   * always; promotes `fulfillmentStatus` only on terminal transitions
   * so non-terminal scans don't churn the order state machine.
   */
  private async applySnapshot(
    subOrderId: string,
    snapshot: TrackingSnapshot,
  ): Promise<void> {
    const deliveredAt =
      snapshot.currentStatus === 'DELIVERED' ? new Date() : undefined;
    const fulfillment = mapToFulfillmentStatus(snapshot.currentStatus);

    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        // Always-mirrored courier fields
        trackingNumber: snapshot.awb,
        courierName: snapshot.carrier,
        // Conditional state-machine promotions
        ...(deliveredAt ? { deliveredAt } : {}),
        ...(fulfillment ? { fulfillmentStatus: fulfillment } : {}),
      },
    });
  }
}

/**
 * Translate the carrier-neutral `ShipmentStatusInternal` onto our
 * SubOrder.fulfillmentStatus enum. Returns undefined when the new
 * snapshot doesn't justify a transition (avoids over-writing
 * upstream state with intermediate scans).
 */
function mapToFulfillmentStatus(
  current: string,
): 'UNFULFILLED' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | undefined {
  switch (current) {
    case 'MANIFESTED':
    case 'PICKED_UP':
      return 'PACKED';
    case 'IN_TRANSIT':
    case 'OUT_FOR_DELIVERY':
    case 'UNDELIVERED':
      return 'SHIPPED';
    case 'DELIVERED':
    case 'REV_DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
    case 'REV_CANCELLED':
      return 'CANCELLED';
    case 'RTO_DELIVERED':
      return 'CANCELLED';
    default:
      return undefined;
  }
}
