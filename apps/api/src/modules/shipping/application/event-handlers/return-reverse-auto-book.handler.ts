// Reverse-logistics auto-book (Step 2) — customer-return pickup.
//
// When a Return is APPROVED (the auto-approval flow or an admin clicking
// "Approve Return" publishes `returns.return.approved`), this handler books a
// REVERSE Delhivery pickup (RVP) for the return's sub-order — pickup from the
// customer, drop at the seller/franchise warehouse — and publishes
// `shipping.return.reverse_booked` carrying the reverse AWB. A returns-module
// handler consumes that to attach the AWB and move the return to
// PICKUP_SCHEDULED (mirrors the forward DelhiveryAutoBookHandler, but for the
// reverse leg, and event-decoupled so neither module imports the other).
//
// Runs POST-COMMIT, OUTSIDE any DB transaction (carrier call is external HTTP).
// FALLBACK-SAFE: if the carrier call fails / returns no AWB (e.g. the Delhivery
// account isn't RVP-enabled), it logs and returns — the return simply stays
// APPROVED and an admin schedules the pickup manually, exactly as today. No
// regression. Idempotent: only APPROVED returns with no pickup AWB are booked.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
} from '../ports/outbound/courier-gateway.port';
import { buildCreateShipmentRequest } from '../mappers/sub-order-to-shipment.mapper';

@Injectable()
export class ReturnReverseAutoBookHandler {
  private readonly logger = new Logger(ReturnReverseAutoBookHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    protected readonly eventDedup: EventDeduplicationService,
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly resolver: CourierGatewayResolver,
    private readonly eventBus: EventBusService,
    private readonly env: EnvService,
  ) {}

  @OnEvent('returns.return.approved')
  @IdempotentHandler()
  async onReturnApproved(event: DomainEvent): Promise<void> {
    // Kill-switch — when off, every return falls back to the manual
    // schedule-pickup flow (no carrier call). Defaults on (existing behaviour).
    if (!this.env.getBoolean('RETURN_AUTO_RVP_ENABLED', true)) return;

    const payload = (event.payload as any) ?? {};
    const returnId = payload.returnId as string | undefined;
    if (!returnId) return;

    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        subOrderId: true,
        pickupTrackingNumber: true,
      },
    });
    if (!ret || !ret.subOrderId) return;
    // Only the first APPROVED→pickup transition triggers booking. If an admin
    // already scheduled (pickup AWB present) or the status moved on, skip.
    if (ret.status !== 'APPROVED') return;
    if (ret.pickupTrackingNumber) return;

    const sub = await this.prisma.subOrder.findUnique({
      where: { id: ret.subOrderId },
      include: {
        items: {
          select: {
            productId: true,
            variantId: true,
            productTitle: true,
            sku: true,
            masterSku: true,
            quantity: true,
            unitPrice: true,
          },
        },
        masterOrder: {
          select: {
            orderNumber: true,
            createdAt: true,
            paymentMethod: true,
            walletAmountUsedInPaise: true,
            subOrders: {
              select: { id: true, subTotal: true, acceptStatus: true },
            },
            shippingAddressSnapshot: true,
            customer: { select: { email: true } },
          },
        },
        seller: {
          select: {
            gstin: true,
            isGstVerified: true,
            sellerShopName: true,
            legalBusinessName: true,
            sellerName: true,
            storeAddress: true,
            city: true,
            state: true,
          },
        },
        franchise: {
          select: {
            gstNumber: true,
            verificationStatus: true,
            businessName: true,
            address: true,
            locality: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
      },
    });
    if (!sub) return;
    // Only Delhivery returns auto-book a reverse pickup; SELF_DELIVERY returns
    // stay on the manual flow.
    if ((sub as any).deliveryMethod !== 'DELHIVERY') return;

    // Enrich items with catalog weight/dimensions (OrderItem has only scalar
    // productId/variantId) so the reverse parcel ships at the real size — same
    // approach as the forward auto-book handler.
    const dimSelect = {
      id: true,
      weight: true,
      weightUnit: true,
      length: true,
      width: true,
      height: true,
      dimensionUnit: true,
    } as const;
    const items = sub.items as Array<{
      productId?: string | null;
      variantId?: string | null;
    }>;
    const productIds = [
      ...new Set(items.map((i) => i.productId).filter((x): x is string => !!x)),
    ];
    const variantIds = [
      ...new Set(items.map((i) => i.variantId).filter((x): x is string => !!x)),
    ];
    const [products, variants] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: dimSelect,
          })
        : Promise.resolve([] as Array<{ id: string }>),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: dimSelect,
          })
        : Promise.resolve([] as Array<{ id: string }>),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const enrichedSub = {
      ...sub,
      items: items.map((it) => ({
        ...it,
        product: it.productId ? productMap.get(it.productId) ?? null : null,
        variant: it.variantId ? variantMap.get(it.variantId) ?? null : null,
      })),
    };

    // Reuse the forward request builder — it already sets drop = customer
    // address and pickupWarehouseName = the node's warehouse, which is exactly
    // the reverse geometry (collect FROM the customer, return TO the
    // warehouse). We only flip the direction to 'reverse'.
    const req = buildCreateShipmentRequest(enrichedSub as any);
    req.direction = 'reverse';
    (req.shipment as any).direction = 'reverse';

    const pickupWarehouseName = await this.resolveNodeWarehouseName(sub as any);
    if (pickupWarehouseName) {
      req.shipment.pickupWarehouseName = pickupWarehouseName;
    }

    let result;
    try {
      result = await this.resolver
        .forMethod('DELHIVERY' as any)
        .createShipment(req);
    } catch (err) {
      this.logger.error(
        `Reverse auto-book failed for return ${ret.returnNumber}: ${
          (err as Error)?.message
        } — leaving APPROVED for manual scheduling.`,
      );
      return;
    }

    if (!result?.success || !result.awb) {
      this.logger.warn(
        `Reverse auto-book returned no AWB for return ${ret.returnNumber}: ${
          result?.errorMessage ?? 'no awb'
        } — leaving APPROVED for manual scheduling.`,
      );
      return;
    }

    // Hand off to the returns module (which owns the FSM) to attach the AWB +
    // transition APPROVED → PICKUP_SCHEDULED.
    await this.eventBus.publish({
      eventName: 'shipping.return.reverse_booked',
      aggregate: 'Return',
      aggregateId: returnId,
      occurredAt: new Date(),
      payload: {
        returnId,
        returnNumber: ret.returnNumber,
        awb: result.awb,
        courierName: 'Delhivery',
        trackingUrl: result.trackingUrl ?? null,
      },
    });
    this.logger.log(
      `Reverse pickup booked for return ${ret.returnNumber} — AWB ${result.awb} (now scheduling pickup)`,
    );
  }

  /**
   * The node's OWN registered Delhivery pickup-warehouse name (the return
   * destination), or null to fall back to the facade default. Mirrors the
   * forward handler's resolver so reverse + forward agree on the warehouse.
   */
  private async resolveNodeWarehouseName(sub: {
    fulfillmentNodeType: string | null;
    sellerId: string | null;
    franchiseId: string | null;
  }): Promise<string | null> {
    if (sub.fulfillmentNodeType === 'FRANCHISE' && sub.franchiseId) {
      const reg = await this.prisma.franchisePartnerRegistration.findUnique({
        where: {
          franchiseId_partner: {
            franchiseId: sub.franchiseId,
            partner: 'DELHIVERY',
          },
        },
        select: { warehouseName: true },
      });
      return reg?.warehouseName ?? null;
    }
    if (sub.sellerId) {
      const reg = await this.prisma.sellerPartnerRegistration.findUnique({
        where: {
          sellerId_partner: { sellerId: sub.sellerId, partner: 'DELHIVERY' },
        },
        select: { warehouseName: true },
      });
      return reg?.warehouseName ?? null;
    }
    return null;
  }
}
