import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
// Phase 3 Delhivery wiring (2026-06-02) — carrier-action orchestration
// (label / cancel / track refresh) for the admin shipping panel.
import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
} from '../ports/outbound/courier-gateway.port';
import { IngestTrackingUpdateUseCase } from '../use-cases/ingest-tracking-update.use-case';
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
import { DelhiveryToolsService } from '../services/delhivery-tools.service';
import { ShippingLabelPdfService } from '../services/shipping-label-pdf.service';
import { OrdersService } from '../../../orders/application/services/orders.service';

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
    // Phase 3 Delhivery wiring — courier resolver + ingest pipeline for the
    // admin label / cancel / track-refresh actions. @Optional so the legacy
    // boot path (without shipping providers) still loads.
    @Optional()
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly courierResolver?: CourierGatewayResolver,
    @Optional() private readonly ingest?: IngestTrackingUpdateUseCase,
    // Phase 90 (2026-06-03) — per-order self-service pickup requests.
    @Optional() private readonly delhiveryTools?: DelhiveryToolsService,
    // Phase 91 (2026-06-03) — Delhivery-first cancel reuses the EXISTING
    // OrdersService.adminCancelSubOrder once the carrier confirms cancellation.
    @Optional() private readonly ordersService?: OrdersService,
    // 2026-06-04 — our own 4x6 label generator; getLabelInfo returns its public
    // URL for Delhivery sub-orders with an AWB (Delhivery slip is the fallback).
    @Optional() private readonly labelPdf?: ShippingLabelPdfService,
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
      // Phase 3 Delhivery wiring (2026-06-02) — provenance of the AWB.
      // Defaults to ADMIN_OVERRIDE (the manual admin path) so existing
      // callers are unaffected; the Delhivery auto-book handler passes
      // 'DELHIVERY_BOOKING' (system actor, no adminId).
      attachmentSource?:
        | 'SELLER_MANUAL'
        | 'FRANCHISE_MANUAL'
        | 'ADMIN_OVERRIDE'
        | 'SHIPROCKET_BOOKING'
        | 'DELHIVERY_BOOKING';
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
    // Phase 3 Delhivery wiring — provenance + actor. System bookings
    // (Delhivery/Shiprocket auto-book) record a SYSTEM actor; the manual
    // admin path keeps ADMIN. Defaults preserve legacy behaviour.
    const attachmentSource = payload.attachmentSource ?? 'ADMIN_OVERRIDE';
    const isSystemBooking =
      attachmentSource === 'DELHIVERY_BOOKING' ||
      attachmentSource === 'SHIPROCKET_BOOKING';
    const actorRole = isSystemBooking ? 'SYSTEM' : 'ADMIN';
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
              awbAttachmentSource: attachmentSource,
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
            attachmentSource,
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
          if (master && master.orderStatus !== target) {
            let from = master.orderStatus as any;
            // 2026-06-02 self-heal: a sub-order can ship while the master is
            // still ROUTED_TO_SELLER — e.g. it was admin-accepted via
            // acceptSubOrder, which (unlike the seller accept) does NOT
            // advance the master to SELLER_ACCEPTED. The OrderStatus FSM has
            // no ROUTED_TO_SELLER → DISPATCHED edge, so without this the
            // rollup silently no-ops and the customer's tracker stays stuck on
            // "Confirmed" while the parcel is in transit. Step through the
            // valid SELLER_ACCEPTED edge first so the master reaches the
            // shipped-aggregate status. Only ever advances forward.
            if (
              from === 'ROUTED_TO_SELLER' &&
              isTransitionAllowed('OrderStatus', from, 'SELLER_ACCEPTED' as any)
            ) {
              await tx.masterOrder.update({
                where: { id: locked.master_order_id },
                data: { orderStatus: 'SELLER_ACCEPTED' as any },
              });
              from = 'SELLER_ACCEPTED';
            }
            if (isTransitionAllowed('OrderStatus', from, target as any)) {
              await tx.masterOrder.update({
                where: { id: locked.master_order_id },
                data: { orderStatus: target as any },
              });
              newMasterStatus = target;
            }
          }
        }

        // 9. Audit log inside the tx (Gap #7).
        if (this.auditFacade) {
          await this.auditFacade.writeAuditLog({
            actorId: adminId ?? null,
            actorRole,
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
              awbAttachmentSource: attachmentSource,
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
              actorType: actorRole,
              actorId: adminId,
              reason: payload.reason ?? null,
              metadata: {
                trackingNumber: payload.awb,
                courierName: payload.courierName,
                trackingUrl,
                source: attachmentSource,
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
              actorKind: actorRole,
              adminId: adminId ?? null,
              trackingNumber: payload.awb,
              courierName: payload.courierName,
              trackingUrl,
              awbAttachmentSource: attachmentSource,
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
      trackingUrl: this.resolveTrackingUrl(
        (sub as any).deliveryMethod,
        sub.trackingNumber,
        sub.trackingUrl ?? sub.shippingLabelUrl,
      ),
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }

  /**
   * Delhivery's public consumer tracker is PATH-based
   * (`https://www.delhivery.com/track/package/<awb>`). Early Delhivery
   * bookings stored a best-guess `?awb=` URL that 404s, so for DELHIVERY
   * sub-orders we rebuild the link from the AWB on read — fixing both
   * already-booked and future shipments without a re-book.
   */
  private resolveTrackingUrl(
    deliveryMethod: string | null | undefined,
    awb: string | null | undefined,
    storedUrl: string | null | undefined,
  ): string | null {
    if (deliveryMethod === 'DELHIVERY' && awb) {
      return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
    }
    return storedUrl ?? null;
  }

  /**
   * Phase 90 (2026-06-03) — per-order self-service pickup. Resolves the
   * sub-order's seller / franchise registered Delhivery pickup warehouse and
   * raises ONE pickup for it. Delhivery pickups are per-warehouse-per-day
   * (idempotency-keyed `pickup-<warehouse>-<date>` at the facade), so clicking
   * "Request pickup" on several orders the same day collapses into a single
   * pickup that collects every ready parcel — letting sellers / retailer /
   * franchise schedule their own pickup instead of routing it through the
   * Super Admin.
   */
  async requestPickupForSubOrder(subOrderId: string): Promise<{
    success: boolean;
    warehouseName: string | null;
    date: string | null;
    expectedPackageCount: number;
    message: string;
  }> {
    const fail = (message: string, warehouseName: string | null = null) => ({
      success: false,
      warehouseName,
      date: null,
      expectedPackageCount: 0,
      message,
    });

    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        deliveryMethod: true,
        fulfillmentNodeType: true,
        sellerId: true,
        franchiseId: true,
      },
    });
    if (!sub) throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);
    if ((sub as any).deliveryMethod !== 'DELHIVERY') {
      return fail('Pickup is only available for Delhivery shipments.');
    }
    if (!this.delhiveryTools) {
      return fail('Pickup service is not available.');
    }

    // Resolve the node's registered Delhivery pickup warehouse.
    const { warehouseName, nodeFilter } = await this.resolvePickupWarehouse(sub);

    if (!warehouseName || !nodeFilter) {
      return fail(
        'No registered Delhivery pickup location for this seller/franchise yet — ' +
          'register it under Settings → Logistics partners first.',
      );
    }

    // Estimate the parcel count = this node's Delhivery shipments awaiting
    // pickup (SHIPPED). Delhivery treats it as an estimate; the pickup run
    // collects whatever is actually scannable that day.
    const readyCount = await this.prisma.subOrder.count({
      where: { ...nodeFilter, deliveryMethod: 'DELHIVERY', fulfillmentStatus: 'SHIPPED' },
    });
    const expectedPackageCount = Math.max(1, readyCount);

    // Pickup must be a FUTURE slot in IST — Delhivery rejects a past time
    // ("Pickup time cannot be in past"). Compute in IST (Asia/Kolkata, UTC+5:30)
    // via an offset-shifted Date whose UTC fields read as IST wall-clock:
    // before 16:00 IST → today, ~2h ahead (floored to 11:00); else next morning.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    const istHour = istNow.getUTCHours();
    let date: string;
    let time: string;
    if (istHour < 16) {
      date = istNow.toISOString().slice(0, 10);
      time = `${String(Math.max(11, istHour + 2)).padStart(2, '0')}:00:00`;
    } else {
      const istTomorrow = new Date(istNow.getTime() + 24 * 60 * 60 * 1000);
      date = istTomorrow.toISOString().slice(0, 10);
      time = '11:00:00';
    }

    try {
      await this.delhiveryTools.raisePickup({
        warehouseName,
        date,
        time,
        expectedPackageCount,
      });
      return {
        success: true,
        warehouseName,
        date,
        expectedPackageCount,
        message:
          `Pickup requested with Delhivery for ${date} ` +
          `(~${expectedPackageCount} parcel${expectedPackageCount === 1 ? '' : 's'}). ` +
          'Delhivery collects all ready parcels at your warehouse that day.',
      };
    } catch (e: any) {
      return fail(
        e?.body?.message || e?.message || 'Delhivery rejected the pickup request.',
        warehouseName,
      );
    }
  }

  /**
   * Resolve a sub-order's fulfillment node (seller / franchise) registered
   * Delhivery pickup warehouse. Returns the warehouse name (null when the node
   * hasn't registered a pickup location with Delhivery) plus a where-filter for
   * counting that node's parcels.
   */
  private async resolvePickupWarehouse(sub: {
    fulfillmentNodeType: string | null;
    sellerId: string | null;
    franchiseId: string | null;
  }): Promise<{
    warehouseName: string | null;
    nodeFilter: { sellerId: string } | { franchiseId: string } | null;
  }> {
    if (sub.fulfillmentNodeType === 'FRANCHISE' && sub.franchiseId) {
      const reg = await this.prisma.franchisePartnerRegistration.findUnique({
        where: {
          franchiseId_partner: { franchiseId: sub.franchiseId, partner: 'DELHIVERY' },
        },
        select: { warehouseName: true },
      });
      return {
        warehouseName: reg?.warehouseName ?? null,
        nodeFilter: { franchiseId: sub.franchiseId },
      };
    }
    if (sub.sellerId) {
      const reg = await this.prisma.sellerPartnerRegistration.findUnique({
        where: { sellerId_partner: { sellerId: sub.sellerId, partner: 'DELHIVERY' } },
        select: { warehouseName: true },
      });
      return {
        warehouseName: reg?.warehouseName ?? null,
        nodeFilter: { sellerId: sub.sellerId },
      };
    }
    return { warehouseName: null, nodeFilter: null };
  }

  /**
   * Phase 91 (2026-06-03) — Delhivery-FIRST cancel. Cancels the shipment at
   * Delhivery first; ONLY if the carrier confirms does it cancel the ORDER via
   * the EXISTING OrdersService.adminCancelSubOrder (same refund / master rollup
   * / audit as PATCH /admin/orders/sub-orders/:id/cancel — no cancel logic is
   * reimplemented here). If Delhivery can't cancel (parcel already picked up),
   * it BLOCKS: the order is left untouched and the caller is told to use Force
   * RTO. Non-Delhivery / not-yet-shipped orders skip the carrier step.
   */
  async cancelOrderWithCourierFirst(
    subOrderId: string,
    adminId: string | undefined,
    reason: string,
    force: boolean,
  ): Promise<{ cancelled: boolean; courierCancelled: boolean; message: string }> {
    if (!this.ordersService) {
      throw new BadRequestAppException('Order cancellation is not available.');
    }
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, deliveryMethod: true, trackingNumber: true },
    });
    if (!sub) {
      throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);
    }

    // 1. Delhivery-FIRST gate: a Delhivery shipment with an AWB must be
    //    cancelled at the carrier first, and the carrier must CONFIRM. If it
    //    can't (parcel already picked up), block — the order is untouched.
    let courierCancelled = false;
    if ((sub as any).deliveryMethod === 'DELHIVERY' && sub.trackingNumber) {
      const cr = await this.cancelCourierShipment(subOrderId);
      if (!cr.success) {
        throw new ConflictAppException(
          `Delhivery couldn't cancel this shipment — the parcel is likely ` +
            `already picked up, so the order was NOT cancelled. Use "Force RTO" ` +
            `to bring the parcel back and refund. (${cr.message})`,
        );
      }
      courierCancelled = true;
    }

    // 2. Carrier confirmed (or nothing to cancel there) → cancel the ORDER via
    //    the existing, proven cancel path (refund + master rollup + audit).
    await this.ordersService.adminCancelSubOrder(
      subOrderId,
      adminId as string,
      reason,
      { force },
    );
    return {
      cancelled: true,
      courierCancelled,
      message: courierCancelled
        ? 'Delhivery shipment cancelled, then order cancelled.'
        : 'Order cancelled.',
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
    labelUrl?: string | null;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        trackingNumber: true,
        courierName: true,
        trackingUrl: true,
        shippingLabelUrl: true,
        deliveryMethod: true,
        fulfillmentStatus: true,
        acceptStatus: true,
      },
    });

    if (!sub) return null;

    // Prefer OUR OWN 4x6 label (clean, SportSmart-branded) for Delhivery
    // sub-orders that have a booked AWB — served via the public signed-token
    // route (no Bearer needed for window.open). Delhivery's own packing slip is
    // the serve-time FALLBACK: the public route redirects to getCarrierLabelUrl
    // if our generation fails. Legacy / non-Delhivery rows keep the stored URL.
    // (labelUrl must NOT fall back to the tracking URL — a tracking page is not
    // a label; that produced a broken 404 link.)
    let labelUrl: string | null = sub.shippingLabelUrl ?? null;
    if (
      this.labelPdf &&
      (sub as any).deliveryMethod === 'DELHIVERY' &&
      sub.trackingNumber
    ) {
      labelUrl = this.labelPdf.buildLabelUrl(subOrderId);
    }

    // A cancelled sub-order's AWB is dead at Delhivery — don't offer ANY label
    // (ours or a legacy stored one), so the Download button disappears instead
    // of handing out a barcode the courier will reject. The serve route blocks
    // it too (defence in depth), but hiding the button is the cleaner UX.
    if (this.isLabelBlockedByStatus(sub as any)) {
      labelUrl = null;
    }

    return {
      subOrderId: sub.id,
      awb: sub.trackingNumber,
      courierName: sub.courierName,
      // Delhivery tracking links are rebuilt from the AWB (see
      // resolveTrackingUrl); legacy non-Delhivery rows keep the stored URL.
      trackingUrl: this.resolveTrackingUrl(
        (sub as any).deliveryMethod,
        sub.trackingNumber,
        sub.trackingUrl ?? sub.shippingLabelUrl,
      ),
      labelUrl,
    };
  }

  /**
   * Delhivery's OWN label PDF URL (the carrier packing slip), fetched on demand.
   * This is the serve-time FALLBACK for the public custom-label route: if our
   * own label can't be generated, the route redirects here so a label is always
   * available. Best-effort — returns the stored URL, else the live carrier
   * printLabel link, else null.
   */
  async getCarrierLabelUrl(subOrderId: string): Promise<string | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        trackingNumber: true,
        shippingLabelUrl: true,
        deliveryMethod: true,
        fulfillmentStatus: true,
        acceptStatus: true,
      },
    });
    if (!sub) return null;
    // Cancelled → its AWB is cancelled at Delhivery; serving the carrier's own
    // label would still hand out the dead barcode, so refuse here too.
    if (this.isLabelBlockedByStatus(sub as any)) return null;
    let url: string | null = sub.shippingLabelUrl ?? null;
    if (
      this.courierResolver &&
      (sub as any).deliveryMethod &&
      sub.trackingNumber
    ) {
      try {
        const result = await this.courierResolver
          .forMethod((sub as any).deliveryMethod)
          .printLabel([sub.trackingNumber]);
        if (result?.fileUrl) url = result.fileUrl;
      } catch (e) {
        this.logger.warn(
          `Carrier label for ${subOrderId} not available yet: ${(e as Error).message}`,
        );
      }
    }
    return url;
  }

  /**
   * True when a sub-order's status means its shipping label must NOT be served.
   * A CANCELLED sub-order has had its AWB cancelled at Delhivery, so printing
   * the barcode would be rejected on scan ("shipment cancelled") and could push
   * the parcel into RTO. Both columns are set on cancel (fulfillment + accept).
   */
  private isLabelBlockedByStatus(s: {
    fulfillmentStatus?: string | null;
    acceptStatus?: string | null;
  }): boolean {
    return s.fulfillmentStatus === 'CANCELLED' || s.acceptStatus === 'CANCELLED';
  }

  /**
   * Reason a label must be blocked for this sub-order, or null if it's fine to
   * serve. Used by the public label route to return a clear message instead of
   * handing out a dead barcode. Missing sub-order → null (the normal not-found
   * path handles it).
   */
  async getLabelBlockReason(subOrderId: string): Promise<string | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { fulfillmentStatus: true, acceptStatus: true },
    });
    if (!sub) return null;
    if (this.isLabelBlockedByStatus(sub as any)) {
      return 'This shipment was cancelled — its label is no longer valid.';
    }
    return null;
  }

  /**
   * Phase 3 Delhivery wiring — cancel the courier shipment for a sub-order
   * (admin action). Best-effort: returns a status object; never throws on a
   * carrier error so the admin UI shows the outcome message.
   */
  async cancelCourierShipment(subOrderId: string): Promise<{
    subOrderId: string;
    awb: string | null;
    success: boolean;
    message: string;
  }> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, trackingNumber: true, deliveryMethod: true },
    });
    if (!sub) throw new NotFoundAppException('Sub-order not found');
    if (!this.courierResolver || !(sub as any).deliveryMethod) {
      return {
        subOrderId,
        awb: sub.trackingNumber,
        success: false,
        message: 'No courier wired for this sub-order',
      };
    }
    if (!sub.trackingNumber) {
      return {
        subOrderId,
        awb: null,
        success: false,
        message: 'No AWB on this sub-order — nothing to cancel at the carrier',
      };
    }
    try {
      const res = await this.courierResolver
        .forMethod((sub as any).deliveryMethod)
        .cancelShipment(sub.trackingNumber);
      return {
        subOrderId,
        awb: sub.trackingNumber,
        success: res.success,
        message: res.success
          ? 'Courier shipment cancelled'
          : res.errorMessage ?? 'Carrier cancel failed',
      };
    } catch (e) {
      return {
        subOrderId,
        awb: sub.trackingNumber,
        success: false,
        message: (e as Error).message,
      };
    }
  }

  /**
   * Phase 3 Delhivery wiring — pull a fresh tracking snapshot from the
   * carrier on demand and feed it through the same ingest pipeline the
   * webhook uses (source MANUAL_ADMIN). Returns the carrier's current status.
   */
  async refreshTracking(subOrderId: string): Promise<{
    subOrderId: string;
    awb: string | null;
    currentStatus: string | null;
    applied: boolean;
    message: string;
  }> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, trackingNumber: true, deliveryMethod: true },
    });
    if (!sub) throw new NotFoundAppException('Sub-order not found');
    if (
      !this.courierResolver ||
      !this.ingest ||
      !(sub as any).deliveryMethod ||
      !sub.trackingNumber
    ) {
      return {
        subOrderId,
        awb: sub.trackingNumber,
        currentStatus: null,
        applied: false,
        message: 'No AWB / courier to refresh',
      };
    }
    try {
      const map = await this.courierResolver
        .forMethod((sub as any).deliveryMethod)
        .track([sub.trackingNumber]);
      const snap = map.get(sub.trackingNumber);
      if (!snap) {
        return {
          subOrderId,
          awb: sub.trackingNumber,
          currentStatus: null,
          applied: false,
          message: 'Carrier returned no tracking yet (AWB may not be registered)',
        };
      }
      const result = await this.ingest.ingestSingleSnapshot(
        sub.trackingNumber,
        snap,
        { source: 'MANUAL_ADMIN' },
      );
      return {
        subOrderId,
        awb: sub.trackingNumber,
        currentStatus: snap.currentStatus,
        applied: result.applied,
        message: result.applied
          ? `Tracking refreshed → ${snap.currentStatus}`
          : `Carrier status ${snap.currentStatus} not applied (${result.reason ?? 'no change'})`,
      };
    } catch (e) {
      return {
        subOrderId,
        awb: sub.trackingNumber,
        currentStatus: null,
        applied: false,
        message: (e as Error).message,
      };
    }
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
