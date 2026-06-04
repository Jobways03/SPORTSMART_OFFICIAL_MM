// Phase 3 Delhivery wiring (2026-06-02) — propagate order cancellation to
// the carrier. When a sub-order with a Delhivery AWB is cancelled — by an ADMIN
// (orders.sub_order.cancelled_by_admin) OR by the CUSTOMER self-cancel path
// (orders.sub_order.cancelled_by_customer) — best-effort cancel the shipment at
// Delhivery (via the resolver → facade) so a booked pickup doesn't stay live
// carrier-side.
//
// Runs POST-COMMIT (the cancel tx has already committed) and NEVER throws —
// a carrier failure must not affect the already-committed cancel/refund. If
// the cancel call fails (e.g. the parcel is already picked up, which is no
// longer cancellable), it is logged AND a shipping.courier_cancel.failed event
// is emitted so ops/a reconciliation sweep can recover the stranded AWB instead
// of it being buried in a log line. (Delhivery's RTO flow returns picked-up
// goods; a booked-but-not-picked AWB that fails to cancel needs the worklist.)

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
} from '../ports/outbound/courier-gateway.port';

@Injectable()
export class DelhiveryCancelHandler {
  private readonly logger = new Logger(DelhiveryCancelHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    protected readonly eventDedup: EventDeduplicationService,
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly resolver: CourierGatewayResolver,
    private readonly eventBus: EventBusService,
  ) {}

  // Subscribe to BOTH cancellation sources so the carrier-cancel safety net
  // covers admin AND customer self-cancels. Idempotent + never-throws, so a
  // double-fire (e.g. the courier-first path also emits cancelled_by_admin) is
  // harmless — Delhivery returns "already cancelled" which maps to success.
  @OnEvent('orders.sub_order.cancelled_by_admin')
  @OnEvent('orders.sub_order.cancelled_by_customer')
  @IdempotentHandler()
  async onSubOrderCancelled(event: DomainEvent): Promise<void> {
    const subOrderId = (event.payload as any)?.subOrderId as string | undefined;
    if (!subOrderId) return;

    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, deliveryMethod: true, trackingNumber: true },
    });
    if (!sub) return;

    // Only Delhivery sub-orders that actually have a booked AWB. A PACKED
    // sub-order cancelled before shipping has no AWB → nothing to cancel.
    if ((sub as any).deliveryMethod !== 'DELHIVERY' || !sub.trackingNumber) {
      return;
    }

    try {
      const result = await this.resolver
        .forMethod('DELHIVERY' as any)
        .cancelShipment(sub.trackingNumber);
      if (result.success) {
        this.logger.log(
          `Delhivery shipment cancelled for cancelled sub-order ${subOrderId} — AWB ${sub.trackingNumber}`,
        );
      } else {
        this.logger.warn(
          `Delhivery cancel not confirmed for sub-order ${subOrderId} (AWB ${sub.trackingNumber}): ${
            result.errorMessage ?? 'unknown'
          } — may already be picked up; carrier RTO will return it.`,
        );
        await this.reportCancelFailure(
          subOrderId,
          sub.trackingNumber,
          result.errorMessage ?? 'carrier cancel not confirmed',
        );
      }
    } catch (err) {
      this.logger.error(
        `Delhivery cancel call failed for sub-order ${subOrderId} (AWB ${sub.trackingNumber}): ${
          (err as Error)?.message
        }`,
      );
      await this.reportCancelFailure(
        subOrderId,
        sub.trackingNumber,
        (err as Error)?.message ?? 'carrier cancel threw',
      );
    }
  }

  /**
   * Surface a carrier-cancel that didn't confirm as a structured event so ops /
   * a reconciliation sweep can recover the stranded AWB — instead of it being
   * buried in a log line (the old silent-best-effort behaviour). Best-effort:
   * if even the emit fails, we just log; the order cancel is already committed.
   */
  private async reportCancelFailure(
    subOrderId: string,
    awb: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        eventName: 'shipping.courier_cancel.failed',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: { subOrderId, awb, carrier: 'DELHIVERY', reason },
      });
    } catch (emitErr) {
      this.logger.error(
        `Failed to emit shipping.courier_cancel.failed for sub-order ${subOrderId} (AWB ${awb}): ${
          (emitErr as Error)?.message
        }`,
      );
    }
  }
}
