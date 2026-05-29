import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  assertTransition,
  isTransitionAllowed,
  type OrderFulfillmentStatus,
} from '../../../../core/fsm/status-transitions';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { TaxPublicFacade } from '../../../tax/application/facades/tax-public.facade';
import { OrderTimelineService } from '../../../orders/application/services/order-timeline.service';
import { buildTrackingUrl } from '../../../orders/presentation/dtos/update-fulfillment-status.dto';

/**
 * Phase 0 (PR 0.8) — closed set of fulfillment values accepted from
 * upstream tracking-normalizer output. Any string not in this set is
 * rejected by `updateShipmentFromTrackingEvent` rather than being
 * silently coerced via `as any` into the Prisma enum.
 */
const VALID_FULFILLMENT_STATUSES: readonly OrderFulfillmentStatus[] = [
  'UNFULFILLED',
  'PACKED',
  'SHIPPED',
  'FULFILLED',
  'DELIVERED',
  'CANCELLED',
];

/**
 * Shipping facade — uses SubOrder fields (trackingNumber, courierName,
 * fulfillmentStatus, shippingLabelUrl) since there is no dedicated
 * Shipment model in the schema.
 */
@Injectable()
export class ShippingPublicFacade {
  private readonly logger = new Logger(ShippingPublicFacade.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    // Phase 85 (2026-05-23) — optional cross-module dependencies.
    // @Optional so the legacy boot path (without these wired) doesn't
    // break — service methods no-op the audit/timeline/tax-invoice
    // hooks when undefined. Production wires all three via the
    // shipping module providers.
    @Optional() private readonly auditFacade?: AuditPublicFacade,
    @Optional() private readonly taxFacade?: TaxPublicFacade,
    @Optional() private readonly timeline?: OrderTimelineService,
  ) {}

  /**
   * Phase 85 (2026-05-23) — manual AWB attachment audit. Replaces the
   * one-line `createShipment` blind-update. Closes:
   *
   *   Gap #2/#3   FSM-enforced transition + acceptStatus='ACCEPTED'
   *               precondition; FOR UPDATE re-check inside the tx.
   *   Gap #5      Master order rollup (PARTIALLY_SHIPPED / DISPATCHED).
   *   Gap #6      Tax invoice generation post-tx.
   *   Gap #7      OrderStatusHistory write + audit_log row + outbox
   *               event publish.
   *   Gap #8      Writes to the dedicated `trackingUrl` column instead
   *               of the `shippingLabelUrl` mix-up.
   *   Gap #11     awbAttachedAt / awbAttachedBy / awbAttachmentSource
   *               persisted.
   *   Gap #12     DB-level partial unique on tracking_number rejects
   *               collisions (P2002 → 409).
   *   Gap #13     SubOrderAwbHistory row inserted; prior active row
   *               (if any) detached with the supplied reason.
   *   Gap #14     Both courier AND awb required (DTO already enforces).
   *   Gap #17/#18 Row lock serialises against seller status update +
   *               cancel/deliver.
   *   Gap #19     Overwrite requires `replace: true` + reason.
   *   Gap #20     orders.sub_order.status_changed event with full
   *               actor + tracking metadata.
   *
   * The legacy `createShipment` name is gone; admin controller calls
   * `attachAwb(subOrderId, payload, adminId)`.
   */
  async attachAwb(
    subOrderId: string,
    payload: {
      courierName: string;
      awb: string;
      trackingUrl?: string;
      replace?: boolean;
      reason?: string;
    },
    adminId?: string,
  ): Promise<{
    subOrderId: string;
    awb: string;
    courierName: string;
    trackingUrl: string | null;
    status: string;
    newMasterStatus: string | null;
  }> {
    const now = new Date();
    // Phase 85 — Gap #10. Build the tracking URL from courier mapping
    // unless the caller supplied an override (e.g. iThink booking
    // path that returns a carrier-specific tracking URL). Falls back
    // to the courier mapping for the standard courier set.
    const trackingUrl =
      payload.trackingUrl ??
      buildTrackingUrl(payload.courierName, payload.awb) ??
      null;

    let newMasterStatus: string | null = null;
    let result: any;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // 1. FOR UPDATE row lock — closes race against seller SHIPPED
        // path + admin cancel/deliver.
        const lockedRows = await tx.$queryRaw<
          Array<{
            id: string;
            accept_status: string;
            fulfillment_status: string;
            master_order_id: string;
            tracking_number: string | null;
          }>
        >`
          SELECT id, accept_status, fulfillment_status, master_order_id, tracking_number
          FROM sub_orders
          WHERE id = ${subOrderId}
          FOR UPDATE
        `;
        const locked = lockedRows[0];
        if (!locked) {
          throw new NotFoundAppException('Sub-order not found');
        }

        // 2. Acceptance precondition (Gap #3).
        if (locked.accept_status !== 'ACCEPTED') {
          throw new BadRequestAppException(
            `Sub-order must be ACCEPTED before attaching AWB (current: ${locked.accept_status})`,
          );
        }

        // 3. FSM gate (Gap #2). Only UNFULFILLED/PACKED → SHIPPED is
        // legal. assertTransition throws BadRequestAppException for
        // anything else (DELIVERED, CANCELLED, REJECTED).
        assertTransition(
          'OrderFulfillmentStatus',
          locked.fulfillment_status as any,
          'SHIPPED',
        );

        // 4. Overwrite guard (Gap #19). A prior AWB requires explicit
        // replace=true + reason. The DTO has already enforced
        // reason-when-replace; this is the server-side gate.
        const hasExistingAwb = locked.tracking_number != null;
        if (hasExistingAwb && !payload.replace) {
          throw new ConflictAppException(
            'Sub-order already has an AWB. Pass replace=true with a reason to overwrite.',
          );
        }

        // 5. Detach the currently-active history row (if any) before
        // inserting the new one — partial unique index on
        // (sub_order_id) WHERE detached_at IS NULL enforces "at most
        // one active row".
        if (hasExistingAwb) {
          await tx.subOrderAwbHistory.updateMany({
            where: { subOrderId, detachedAt: null },
            data: { detachedAt: now },
          });
        }

        // 6. Update the sub-order. Phase 85 — Gap #8 fix: write to
        // the dedicated `trackingUrl` column, not `shippingLabelUrl`.
        let updatedRow: any;
        try {
          updatedRow = await tx.subOrder.update({
            where: { id: subOrderId },
            data: {
              fulfillmentStatus: 'SHIPPED',
              trackingNumber: payload.awb,
              courierName: payload.courierName,
              trackingUrl,
              shippedAt: now,
              shippedBy: adminId ?? null,
              awbAttachedAt: now,
              awbAttachedBy: adminId ?? null,
              awbAttachmentSource: 'ADMIN_OVERRIDE',
            } as any,
          });
        } catch (err: any) {
          // Phase 85 — Gap #12. Partial unique on tracking_number;
          // a collision with another sub-order's AWB raises P2002.
          if (err?.code === 'P2002') {
            throw new ConflictAppException(
              `AWB ${payload.awb} is already attached to another sub-order`,
            );
          }
          throw err;
        }

        // 7. Insert the new AWB history row (Gap #13).
        await tx.subOrderAwbHistory.create({
          data: {
            subOrderId,
            awbNumber: payload.awb,
            courierName: payload.courierName,
            trackingUrl,
            attachmentSource: 'ADMIN_OVERRIDE',
            attachedBy: adminId ?? null,
            reason: payload.reason ?? null,
            attachedAt: now,
          } as any,
        });

        // 8. Master rollup (Gap #5). Scan siblings; if all SHIPPED/
        // DELIVERED → DISPATCHED, else PARTIALLY_SHIPPED.
        const siblings = await tx.subOrder.findMany({
          where: { masterOrderId: locked.master_order_id },
          select: { id: true, fulfillmentStatus: true, acceptStatus: true },
        });
        const active = siblings.filter(
          (s: any) => s.acceptStatus !== 'REJECTED',
        );
        const shippedOrLater = active.filter((s: any) =>
          ['SHIPPED', 'DELIVERED'].includes(s.fulfillmentStatus),
        );
        const target =
          shippedOrLater.length === active.length && active.length > 0
            ? 'DISPATCHED'
            : shippedOrLater.length > 0
              ? 'PARTIALLY_SHIPPED'
              : null;
        if (target) {
          const master = await tx.masterOrder.findUnique({
            where: { id: locked.master_order_id },
            select: { orderStatus: true },
          });
          if (
            master &&
            master.orderStatus !== target &&
            isTransitionAllowed(
              'OrderStatus',
              master.orderStatus as any,
              target as any,
            )
          ) {
            await tx.masterOrder.update({
              where: { id: locked.master_order_id },
              data: { orderStatus: target as any },
            });
            newMasterStatus = target;
          }
        }

        // 9. Audit log inside the tx (Gap #7).
        if (this.auditFacade) {
          await this.auditFacade.writeAuditLog({
            actorId: adminId ?? null,
            actorRole: 'ADMIN',
            action: 'SUB_ORDER_AWB_ATTACHED',
            module: 'orders',
            resource: 'SubOrder',
            resourceId: subOrderId,
            oldValue: {
              fulfillmentStatus: locked.fulfillment_status,
              trackingNumber: locked.tracking_number,
            },
            newValue: {
              fulfillmentStatus: 'SHIPPED',
              trackingNumber: payload.awb,
              courierName: payload.courierName,
              trackingUrl,
              awbAttachmentSource: 'ADMIN_OVERRIDE',
              replaced: hasExistingAwb,
              reason: payload.reason ?? null,
              newMasterStatus,
            },
          } as any);
        }

        // 10. Timeline event inside the tx (Gap #7).
        if (this.timeline) {
          await this.timeline.record(
            {
              masterOrderId: locked.master_order_id,
              subOrderId,
              eventType: 'SUBORDER_SHIPPED',
              oldStatus: locked.fulfillment_status,
              newStatus: 'SHIPPED',
              actorType: 'ADMIN',
              actorId: adminId,
              reason: payload.reason ?? null,
              metadata: {
                trackingNumber: payload.awb,
                courierName: payload.courierName,
                trackingUrl,
                source: 'ADMIN_OVERRIDE',
                replaced: hasExistingAwb,
              },
            },
            tx,
          );
          if (newMasterStatus) {
            await this.timeline.record(
              {
                masterOrderId: locked.master_order_id,
                eventType:
                  newMasterStatus === 'DISPATCHED'
                    ? 'ORDER_ROUTED_TO_SELLER'
                    : 'ORDER_PARTIALLY_SHIPPED',
                newStatus: newMasterStatus,
                actorType: 'SYSTEM',
              },
              tx,
            );
          }
        }

        // 11. Outbox-aware event publish (Gap #20).
        await this.eventBus.publish(
          {
            eventName: 'orders.sub_order.status_changed',
            aggregate: 'SubOrder',
            aggregateId: subOrderId,
            occurredAt: now,
            payload: {
              subOrderId,
              masterOrderId: locked.master_order_id,
              previousStatus: locked.fulfillment_status,
              newStatus: 'SHIPPED',
              actorKind: 'ADMIN',
              adminId: adminId ?? null,
              trackingNumber: payload.awb,
              courierName: payload.courierName,
              trackingUrl,
              awbAttachmentSource: 'ADMIN_OVERRIDE',
              newMasterStatus,
            },
          },
          { tx },
        );

        return updatedRow;
      });
    } catch (err) {
      throw err;
    }

    // 12. Tax invoice — fire-and-forget post-tx (Gap #6).
    if (this.taxFacade) {
      this.taxFacade
        .generateInvoiceForSubOrder(subOrderId)
        .catch((e) =>
          this.logger.warn(
            `Failed to generate tax invoice for ${subOrderId}: ${
              (e as Error).message
            }`,
          ),
        );
    }

    this.logger.log(
      `Sub-order ${subOrderId} AWB attached: ${payload.awb} via ${payload.courierName} (admin=${adminId})`,
    );

    return {
      subOrderId: result.id,
      awb: result.trackingNumber,
      courierName: result.courierName,
      trackingUrl: result.trackingUrl ?? null,
      status: result.fulfillmentStatus,
      newMasterStatus,
    };
  }

  async getShipmentBySubOrderId(subOrderId: string): Promise<{
    subOrderId: string;
    awb: string | null;
    courierName: string | null;
    status: string;
    trackingUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
    });

    if (!sub) return null;

    return {
      subOrderId: sub.id,
      awb: sub.trackingNumber,
      courierName: sub.courierName,
      status: sub.fulfillmentStatus,
      // Phase 85 — Gap #8. Prefer the dedicated `trackingUrl` column;
      // fall back to `shippingLabelUrl` for legacy rows that
      // pre-date the Phase 85 column split.
      trackingUrl: sub.trackingUrl ?? sub.shippingLabelUrl,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }

  async updateShipmentFromTrackingEvent(
    subOrderId: string,
    event: { status: string; location?: string; timestamp?: Date },
  ): Promise<void> {
    // Phase 0 (PR 0.8) — previously this method cast `event.status as
    // any` and wrote whatever string the tracking normalizer produced
    // into the Prisma enum. A malformed normalizer output would
    // corrupt the sub-order state silently. Now:
    //   1. Reject any value not in the OrderFulfillmentStatus enum
    //   2. Read current sub-order status and assert the FSM matrix
    //      allows the transition
    //   3. Use a status-conditional updateMany so a concurrent admin
    //      cancel doesn't get overwritten by a late tracking event
    if (!VALID_FULFILLMENT_STATUSES.includes(event.status as OrderFulfillmentStatus)) {
      this.logger.warn(
        `Sub-order ${subOrderId}: rejected tracking event with unknown fulfillment status ${event.status}`,
      );
      return;
    }
    const target = event.status as OrderFulfillmentStatus;

    const current = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { fulfillmentStatus: true },
    });
    if (!current) {
      this.logger.warn(
        `Sub-order ${subOrderId}: tracking event for missing sub-order`,
      );
      return;
    }
    if (!isTransitionAllowed('OrderFulfillmentStatus', current.fulfillmentStatus, target)) {
      this.logger.warn(
        `Sub-order ${subOrderId}: skipping illegal fulfillment transition ` +
          `${current.fulfillmentStatus} → ${target} from tracking event`,
      );
      return;
    }

    const result = await this.prisma.subOrder.updateMany({
      where: { id: subOrderId, fulfillmentStatus: current.fulfillmentStatus },
      data: { fulfillmentStatus: target },
    });
    if (result.count === 0) {
      this.logger.log(
        `Sub-order ${subOrderId}: tracking event lost a race against another writer (was ${current.fulfillmentStatus})`,
      );
      return;
    }

    this.logger.log(`Sub-order ${subOrderId} updated to fulfillment status: ${target}`);
  }

  /**
   * Phase 87 (2026-05-23) — NDR/RTO audit Gap #3 closure.
   *
   * Pre-Phase-87 this returned `{ isNdr: false, isRto: false }` for
   * every sub-order with the comment "not yet tracked". The admin
   * UI's NDR/RTO investigation surface was a literal lie.
   *
   * NDR/RTO columns + history tables landed in Phase 87 so this
   * method now reads:
   *   • isNdr = ndrAttemptCount > 0 AND not in RTO/terminal
   *   • isRto = rtoInitiatedAt IS NOT NULL (carrier-side or admin-forced)
   *   • attemptCount + lastReason + the RTO milestone timestamps
   *   • the granular ShipmentStatus from the latest tracking event
   *     (the carrier-side detail beyond the business-level
   *     fulfillmentStatus rollup).
   */
  async getNdrRtoState(subOrderId: string): Promise<{
    subOrderId: string;
    status: string;
    shipmentStatus: string | null;
    isNdr: boolean;
    isRto: boolean;
    ndrAttemptCount: number;
    ndrLastAttemptAt: Date | null;
    ndrLastReason: string | null;
    ndrLastReasonCode: string | null;
    ndrStatus: string | null;
    rtoInitiatedAt: Date | null;
    rtoInTransitAt: Date | null;
    rtoDeliveredAt: Date | null;
    rtoReason: string | null;
    ndrAttempts: Array<{
      attemptNumber: number;
      attemptedAt: Date;
      reason: string | null;
      reasonCode: string | null;
      scanLocation: string | null;
    }>;
    rtoEvents: Array<{
      status: string;
      occurredAt: Date;
      reason: string | null;
      scanLocation: string | null;
    }>;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        fulfillmentStatus: true,
        ndrAttemptCount: true,
        ndrLastAttemptAt: true,
        ndrLastReason: true,
        ndrLastReasonCode: true,
        ndrStatus: true,
        rtoInitiatedAt: true,
        rtoInTransitAt: true,
        rtoDeliveredAt: true,
        rtoReason: true,
        ndrAttempts: {
          orderBy: { attemptNumber: 'desc' },
          take: 10,
          select: {
            attemptNumber: true,
            attemptedAt: true,
            reason: true,
            reasonCode: true,
            scanLocation: true,
          },
        },
        rtoEvents: {
          orderBy: { occurredAt: 'desc' },
          take: 10,
          select: {
            status: true,
            occurredAt: true,
            reason: true,
            scanLocation: true,
          },
        },
        trackingEvents: {
          orderBy: { scanAt: 'desc' },
          take: 1,
          select: { internalStatus: true },
        },
      },
    });

    if (!sub) return null;

    const isRto = sub.rtoInitiatedAt !== null;
    const isNdr =
      !isRto &&
      sub.ndrAttemptCount > 0 &&
      sub.fulfillmentStatus !== 'DELIVERED' &&
      sub.fulfillmentStatus !== 'CANCELLED';

    return {
      subOrderId: sub.id,
      status: sub.fulfillmentStatus,
      shipmentStatus: sub.trackingEvents[0]?.internalStatus ?? null,
      isNdr,
      isRto,
      ndrAttemptCount: sub.ndrAttemptCount,
      ndrLastAttemptAt: sub.ndrLastAttemptAt,
      ndrLastReason: sub.ndrLastReason,
      ndrLastReasonCode: sub.ndrLastReasonCode,
      ndrStatus: sub.ndrStatus,
      rtoInitiatedAt: sub.rtoInitiatedAt,
      rtoInTransitAt: sub.rtoInTransitAt,
      rtoDeliveredAt: sub.rtoDeliveredAt,
      rtoReason: sub.rtoReason,
      ndrAttempts: sub.ndrAttempts,
      rtoEvents: sub.rtoEvents,
    };
  }

  async getLabelInfo(subOrderId: string): Promise<{
    subOrderId: string;
    awb: string | null;
    courierName: string | null;
    trackingUrl: string | null;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        trackingNumber: true,
        courierName: true,
        trackingUrl: true,
        shippingLabelUrl: true,
      },
    });

    if (!sub) return null;

    return {
      subOrderId: sub.id,
      awb: sub.trackingNumber,
      courierName: sub.courierName,
      // Phase 85 — Gap #8. Prefer the dedicated `trackingUrl` column;
      // legacy rows fall through to `shippingLabelUrl`.
      trackingUrl: sub.trackingUrl ?? sub.shippingLabelUrl,
    };
  }

  async validateShipmentStage(subOrderId: string): Promise<{
    subOrderId: string;
    currentStatus: string;
    canDispatch: boolean;
    canDeliver: boolean;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, fulfillmentStatus: true },
    });

    if (!sub) return null;

    const dispatchable = ['UNFULFILLED', 'PACKED'];
    const deliverable = ['SHIPPED'];

    return {
      subOrderId: sub.id,
      currentStatus: sub.fulfillmentStatus,
      canDispatch: dispatchable.includes(sub.fulfillmentStatus),
      canDeliver: deliverable.includes(sub.fulfillmentStatus),
    };
  }
}
