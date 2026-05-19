import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
  type TrackingSnapshot,
} from '../ports/outbound/courier-gateway.port';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';

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
    // Phase 3 / C5 — broadcast every accepted snapshot so
    // notifications + audit + the future tracking-history table can
    // subscribe. Without this the customer's order page is silent
    // between PACKED and DELIVERED — IN_TRANSIT / OUT_FOR_DELIVERY
    // / NDR / RTO transitions never fire.
    private readonly eventBus: EventBusService,
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
   * Phase 5 follow-up (2026-05-16) — webhook entry point.
   *
   * Resolve an AWB to its SubOrder and apply the supplied snapshot.
   * Returns the SubOrder id touched, or null when the AWB is orphan
   * (no matching SubOrder — likely a re-shipment AWB the platform
   * never minted, or a cross-tenant misdelivery).
   */
  async ingestSingleSnapshot(
    awb: string,
    snapshot: TrackingSnapshot,
  ): Promise<{ subOrderId: string | null; applied: boolean }> {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { ithinkAwb: awb },
      select: { id: true, fulfillmentStatus: true },
    });
    if (!subOrder) {
      this.logger.warn(`Tracking update for unknown AWB ${awb} — orphan?`);
      return { subOrderId: null, applied: false };
    }
    await this.applySnapshot(subOrder.id, snapshot);
    return { subOrderId: subOrder.id, applied: true };
  }

  /**
   * Apply a snapshot to a SubOrder. Updates the courier-side fields
   * always; promotes `fulfillmentStatus` only on terminal transitions
   * so non-terminal scans don't churn the order state machine.
   *
   * Phase 5 follow-up (2026-05-16) — promoted to public so the iThink
   * webhook controller can hand off pushed events using the same
   * apply path as the polling cron. Keeps the state-machine logic in
   * one place regardless of how the event arrived.
   */
  async applySnapshot(
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

    // Phase 3 / C5 — broadcast the snapshot. Three publishes,
    // ranked by specificity:
    //
    //   1. The generic tracking.updated event ALWAYS fires — every
    //      IN_TRANSIT / OUT_FOR_DELIVERY / NDR / DELIVERED / RTO
    //      snapshot lands on this name. Notifications subscribes
    //      here for the "your order is on its way" / "out for
    //      delivery today" SMS.
    //   2. ndr.raised fires only when the carrier reports UNDELIVERED
    //      (first failed attempt). The returns module subscribes to
    //      start the NDR follow-up clock.
    //   3. rto.delivered fires only when the goods are returned to
    //      origin. Returns + payments subscribe to start a refund
    //      flow — the customer paid but the seller has the goods.
    //
    // Best-effort: the SubOrder.update above has already committed
    // the courier-side state; a missed event is recoverable via the
    // outbox replay path.
    await this.publishTrackingEvents(subOrderId, snapshot).catch((err) => {
      this.logger.warn(
        `Failed to publish tracking events for sub-order ${subOrderId} ` +
          `(awb ${snapshot.awb}): ${(err as Error).message}`,
      );
    });
  }

  private async publishTrackingEvents(
    subOrderId: string,
    snapshot: TrackingSnapshot,
  ): Promise<void> {
    const occurredAt = new Date();

    // 1. Generic update — every snapshot.
    await this.eventBus.publish({
      eventName: SHIPPING_EVENTS.TRACKING_UPDATED,
      aggregate: 'SubOrder',
      aggregateId: subOrderId,
      occurredAt,
      payload: {
        subOrderId,
        awb: snapshot.awb,
        carrier: snapshot.carrier,
        status: snapshot.currentStatus,
      },
    });

    // 2. NDR — first failed delivery attempt.
    if (snapshot.currentStatus === 'UNDELIVERED') {
      await this.eventBus.publish({
        eventName: SHIPPING_EVENTS.NDR_RAISED,
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt,
        payload: {
          subOrderId,
          awb: snapshot.awb,
          carrier: snapshot.carrier,
        },
      });
    }

    // 3. RTO terminal — return-to-origin completed.
    if (snapshot.currentStatus === 'RTO_DELIVERED') {
      await this.eventBus.publish({
        eventName: SHIPPING_EVENTS.RTO_DELIVERED,
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt,
        payload: {
          subOrderId,
          awb: snapshot.awb,
          carrier: snapshot.carrier,
        },
      });
    }
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
