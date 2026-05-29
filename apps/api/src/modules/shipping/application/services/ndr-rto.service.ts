// Phase 87 (2026-05-23) — NDR/RTO audit Gap #1 closure.
//
// Pre-Phase-87 this file was `export class UndrUrtoService {}` —
// the module wired it as a provider but it had no methods. The
// admin/customer NDR-action + force-RTO endpoints (Gap #14) need a
// service to delegate into, and the auto-RTO trigger (Gap #18)
// needs a single entry point that:
//   • flips ndrStatus to EXHAUSTED + persists rtoInitiatedAt
//   • inserts an RtoEvent history row
//   • calls the carrier's initiateRto adapter
//   • emits SHIPPING_EVENTS.RTO_INITIATED
// The applySnapshot path (carrier-driven RTO_INITIATED webhooks)
// persists the same shape directly inside its $transaction — this
// service is the manual/admin counterpart.

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';
import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
} from '../ports/outbound/courier-gateway.port';

export type NdrCustomerAction =
  | 'REATTEMPT'
  | 'CONVERT_TO_RTO'
  | 'UPDATE_ADDRESS';

@Injectable()
export class NdrRtoService {
  private readonly logger = new Logger(NdrRtoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly courierResolver: CourierGatewayResolver,
  ) {}

  /**
   * Admin / customer triggered: respond to an NDR. Routes to the
   * carrier's reattempt or initiateRto adapter (Gap #15) so a stuck
   * NDR can progress instead of waiting for the carrier's own
   * retry schedule.
   *
   *   REATTEMPT        — ask carrier to retry delivery
   *   CONVERT_TO_RTO   — abandon delivery, send the parcel back
   *   UPDATE_ADDRESS   — push new address + retry
   */
  async handleNdrAction(args: {
    subOrderId: string;
    action: NdrCustomerAction;
    actorId: string;
    actorType: 'CUSTOMER' | 'ADMIN' | 'SELLER' | 'FRANCHISE';
    newAddress?: string;
    reason?: string;
  }): Promise<{ outcome: 'OK' | 'CARRIER_ERROR'; message?: string }> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: args.subOrderId },
      select: {
        id: true,
        trackingNumber: true,
        deliveryMethod: true,
        courierName: true,
        ndrAttemptCount: true,
        ndrStatus: true,
        rtoInitiatedAt: true,
        fulfillmentStatus: true,
      },
    });
    if (!sub) {
      throw new NotFoundAppException(`Sub-order ${args.subOrderId} not found`);
    }
    if (sub.rtoInitiatedAt) {
      throw new BadRequestAppException(
        'Cannot act on NDR: sub-order is already in RTO',
      );
    }
    if (sub.fulfillmentStatus === 'DELIVERED') {
      throw new BadRequestAppException(
        'Cannot act on NDR: sub-order is already delivered',
      );
    }
    if (sub.fulfillmentStatus === 'CANCELLED') {
      throw new BadRequestAppException(
        'Cannot act on NDR: sub-order is cancelled',
      );
    }

    const awb = sub.trackingNumber;
    if (!awb) {
      throw new BadRequestAppException(
        'Cannot act on NDR: sub-order has no AWB attached',
      );
    }
    if (!sub.deliveryMethod) {
      throw new BadRequestAppException(
        'Cannot act on NDR: sub-order has no delivery method set',
      );
    }

    // Resolve the carrier adapter for this sub-order's delivery method.
    // Self-delivery throws CarrierCapabilityError (no carrier NDR/RTO),
    // handled by the catch below; a future courier implements the surface.
    const gateway = this.courierResolver.forMethod(sub.deliveryMethod);
    try {
      if (args.action === 'CONVERT_TO_RTO') {
        await gateway.initiateRto({
          awb,
          remark: args.reason ?? 'CUSTOMER_REQUESTED',
        });
        await this.markNdrResolved(args.subOrderId, 'CONVERT_TO_RTO');
      } else if (args.action === 'REATTEMPT' || args.action === 'UPDATE_ADDRESS') {
        // The customer-facing endpoint asks for a date/time + the
        // address book row; the controller resolves those before
        // calling this method. For minimal viable wiring, default
        // to "next business day" + the address text the caller
        // passed (UPDATE_ADDRESS sends a new one; REATTEMPT reuses).
        await gateway.reattempt({
          awb,
          date: nextBusinessDayIso(),
          time: '10:00-18:00',
          address: args.newAddress ?? '',
          mobile: '',
          addressType: 'HOME',
        });
        await this.prisma.subOrder.update({
          where: { id: args.subOrderId },
          data: { ndrStatus: 'CUSTOMER_RESPONDED' },
        });
      }
    } catch (err) {
      this.logger.error(
        `NDR action ${args.action} failed for sub-order ${args.subOrderId}: ${
          (err as Error).message
        }`,
      );
      return { outcome: 'CARRIER_ERROR', message: (err as Error).message };
    }

    await this.eventBus
      .publish({
        eventName: SHIPPING_EVENTS.NDR_RESOLVED,
        aggregate: 'SubOrder',
        aggregateId: args.subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId: args.subOrderId,
          action: args.action,
          actorId: args.actorId,
          actorType: args.actorType,
        },
      })
      .catch(() => undefined);

    return { outcome: 'OK' };
  }

  /**
   * Admin-only: force a sub-order into RTO before the carrier auto-
   * converts. Persists rtoInitiatedAt + RtoEvent + fires the
   * RTO_INITIATED event so notification / refund subscribers wake.
   *
   * Gap #14/#24 — admin override; audit row written by the caller.
   */
  async forceInitiateRto(args: {
    subOrderId: string;
    reason: string;
    adminId: string;
  }): Promise<void> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: args.subOrderId },
      select: {
        id: true,
        trackingNumber: true,
        deliveryMethod: true,
        rtoInitiatedAt: true,
        fulfillmentStatus: true,
      },
    });
    if (!sub) {
      throw new NotFoundAppException(`Sub-order ${args.subOrderId} not found`);
    }
    if (sub.rtoInitiatedAt) {
      throw new BadRequestAppException('Sub-order is already in RTO');
    }
    if (sub.fulfillmentStatus === 'DELIVERED') {
      throw new BadRequestAppException(
        'Cannot force RTO on a delivered sub-order',
      );
    }
    const awb = sub.trackingNumber;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: args.subOrderId },
        data: {
          rtoInitiatedAt: now,
          rtoReason: args.reason,
          ndrStatus: 'EXHAUSTED',
        },
      });
      await tx.rtoEvent.create({
        data: {
          subOrderId: args.subOrderId,
          status: 'RTO_INITIATED',
          occurredAt: now,
          reason: args.reason,
        },
      });

      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.RTO_INITIATED,
          aggregate: 'SubOrder',
          aggregateId: args.subOrderId,
          occurredAt: now,
          payload: {
            subOrderId: args.subOrderId,
            reason: args.reason,
            source: 'ADMIN_FORCE',
            adminId: args.adminId,
            awb,
          },
        },
        { tx } as any,
      );
    });

    if (awb && sub.deliveryMethod) {
      const gateway = this.courierResolver.forMethod(sub.deliveryMethod);
      try {
        await gateway.initiateRto({ awb, remark: args.reason });
      } catch (err) {
        this.logger.warn(
          `Carrier-side initiateRto failed for ${awb}: ${(err as Error).message}` +
            ' — DB-side RTO state is committed; carrier sweep will reconcile.',
        );
      }
    }
  }

  /**
   * Auto-RTO trigger from `applySnapshot` when ndrAttemptCount >=
   * threshold (Gap #18). Same shape as forceInitiateRto but stamps
   * `source: 'AUTO_THRESHOLD'` on the audit trail.
   */
  async autoInitiateRtoForExhaustedNdr(args: {
    subOrderId: string;
    attemptCount: number;
    threshold: number;
  }): Promise<void> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: args.subOrderId },
      select: { id: true, trackingNumber: true, rtoInitiatedAt: true },
    });
    if (!sub || sub.rtoInitiatedAt) return;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: args.subOrderId },
        data: {
          rtoInitiatedAt: now,
          rtoReason: `Auto-RTO after ${args.attemptCount} NDR attempts (threshold ${args.threshold})`,
          ndrStatus: 'EXHAUSTED',
        },
      });
      await tx.rtoEvent.create({
        data: {
          subOrderId: args.subOrderId,
          status: 'RTO_INITIATED',
          occurredAt: now,
          reason: `Auto-RTO after ${args.attemptCount} NDR attempts`,
        },
      });
      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.RTO_INITIATED,
          aggregate: 'SubOrder',
          aggregateId: args.subOrderId,
          occurredAt: now,
          payload: {
            subOrderId: args.subOrderId,
            source: 'AUTO_THRESHOLD',
            attemptCount: args.attemptCount,
            awb: sub.trackingNumber,
          },
        },
        { tx } as any,
      );
    });
  }

  private async markNdrResolved(
    subOrderId: string,
    resolution: NdrCustomerAction | 'AUTO_EXHAUSTED',
  ): Promise<void> {
    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        ndrStatus:
          resolution === 'CONVERT_TO_RTO' || resolution === 'AUTO_EXHAUSTED'
            ? 'EXHAUSTED'
            : 'CUSTOMER_RESPONDED',
      },
    });
  }
}

// Next business day in YYYY-MM-DD form. Skip Sat/Sun — carriers
// typically don't run weekend re-attempts in IN-IN routes.
function nextBusinessDayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}
