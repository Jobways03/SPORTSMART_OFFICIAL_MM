// Phase 3 Delhivery wiring (2026-06-02) — automatic courier booking.
//
// When a DELHIVERY sub-order is marked PACKED (the seller/franchise
// "Mark as Packed" action publishes `orders.sub_order.status_changed`
// with newStatus='PACKED'), this handler books the shipment with
// Delhivery via the logistics-facade and attaches the returned AWB —
// replacing the manual admin "attach AWB" step.
//
// attachAwb performs the PACKED→SHIPPED transition + master rollup +
// tax-invoice hook, so the sub-order lands in SHIPPED with a real
// Delhivery AWB + tracking URL, fully automatically.
//
// Runs POST-COMMIT (the pack tx has already committed) and OUTSIDE any DB
// transaction — booking is an external HTTP call. Idempotent on three
// levels: (1) only the PACKED transition triggers it, (2) it skips if the
// sub-order already has an AWB, (3) the Delhivery adapter calls the facade
// with idempotencyKey=subOrderId so a replayed event cannot double-book.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
} from '../ports/outbound/courier-gateway.port';
import { ShippingPublicFacade } from '../facades/shipping-public.facade';
import { buildCreateShipmentRequest } from '../mappers/sub-order-to-shipment.mapper';

@Injectable()
export class DelhiveryAutoBookHandler {
  private readonly logger = new Logger(DelhiveryAutoBookHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    protected readonly eventDedup: EventDeduplicationService,
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly resolver: CourierGatewayResolver,
    private readonly shipping: ShippingPublicFacade,
  ) {}

  @OnEvent('orders.sub_order.status_changed')
  @IdempotentHandler()
  async onSubOrderStatusChanged(event: DomainEvent): Promise<void> {
    const payload = (event.payload as any) ?? {};
    // Only the PACKED transition triggers booking. SHIPPED / other events
    // (including the one attachAwb itself publishes) are ignored, so there
    // is no recursion.
    if (payload.newStatus !== 'PACKED') return;

    const subOrderId = payload.subOrderId as string | undefined;
    if (!subOrderId) return;

    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
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
            // Wallet + sibling subtotals so the mapper can net the wallet
            // portion out of the courier COD amount (no double-charge at door).
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

    // Guards: only DELHIVERY sub-orders, and skip if already booked.
    if ((sub as any).deliveryMethod !== 'DELHIVERY') return;
    if ((sub as any).trackingNumber) {
      this.logger.log(
        `Sub-order ${subOrderId} already has AWB ${(sub as any).trackingNumber} — skipping auto-book`,
      );
      return;
    }

    // Catalog weight/dimensions live on Product / ProductVariant. OrderItem
    // has NO Prisma relation to them (only scalar productId / variantId), so
    // fetch them in two batched queries and attach to each line item — this
    // is what makes the mapper send Delhivery the real parcel size instead of
    // the 0.5 kg / 10×10×10 cm fallback.
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

    // 1. Book the shipment (external HTTP → logistics-facade → Delhivery),
    //    strictly OUTSIDE any DB transaction.
    const req = buildCreateShipmentRequest(enrichedSub as any);

    // Pickup from the SELLER's / franchise's OWN registered Delhivery warehouse
    // (not the single global default) so the parcel ships from where their
    // stock is, and so the booked warehouse matches the one "Request pickup"
    // schedules. Falls back to the facade's default warehouse when the node has
    // no registration.
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
        `Delhivery auto-book failed for sub-order ${subOrderId}: ${
          (err as Error)?.message
        }`,
      );
      return;
    }

    if (!result?.success || !result.awb) {
      this.logger.warn(
        `Delhivery auto-book did not return an AWB for sub-order ${subOrderId}: ${
          result?.errorMessage ?? 'no awb'
        }`,
      );
      return;
    }

    // 2. Attach the AWB via the proven manual path — performs PACKED→SHIPPED,
    //    master rollup, audit/timeline, and the tax-invoice hook. System
    //    actor (no adminId), provenance DELHIVERY_BOOKING.
    try {
      await this.shipping.attachAwb(
        subOrderId,
        {
          courierName: 'Delhivery',
          awb: result.awb,
          trackingUrl: result.trackingUrl,
          attachmentSource: 'DELHIVERY_BOOKING',
        },
        undefined,
      );
      this.logger.log(
        `Delhivery auto-booked sub-order ${subOrderId} — AWB ${result.awb} (now SHIPPED)`,
      );
    } catch (err) {
      // attachAwb throws ConflictAppException if an AWB already exists
      // (e.g. a racing booking). The shipment is booked either way; just log.
      this.logger.warn(
        `Delhivery AWB attach for sub-order ${subOrderId} failed post-book: ${
          (err as Error)?.message
        }`,
      );
    }
  }

  /**
   * The node's OWN registered Delhivery pickup-warehouse name, or null if it has
   * none (caller then falls back to the facade's default warehouse). Mirrors
   * ShippingPublicFacade.resolvePickupWarehouse so the auto-book warehouse and
   * the Request-pickup warehouse always agree.
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
