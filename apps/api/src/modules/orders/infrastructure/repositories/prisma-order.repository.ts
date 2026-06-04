import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  OrderRepository,
  ReassignmentLogEntity,
  ReassignmentLogQueryOptions,
  ReassignmentEventType,
  ReassignmentNodeType,
} from '../../domain/repositories/order.repository.interface';
import { Prisma } from '@prisma/client';

// Phase 79 (2026-05-22) — page-size cap so a misbehaving client can't
// demand 50 000 rows in one shot and DoS the order-detail endpoint.
const MAX_REASSIGNMENT_PAGE_SIZE = 100;
const DEFAULT_REASSIGNMENT_PAGE_SIZE = 50;

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Master Order queries ───────────────────────────────────────────────

  async findMasterOrders(
    where: Prisma.MasterOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<any[]> {
    return this.prisma.masterOrder.findMany({
      where,
      include: {
        customer: {
          select: { firstName: true, lastName: true, email: true },
        },
        subOrders: {
          include: {
            items: true,
            seller: {
              select: {
                id: true,
                sellerName: true,
                sellerShopName: true,
                email: true,
              },
            },
          },
        },
        // Surface return status to the admin list so ops can spot orders
        // with open return flows without drilling into each detail page.
        // Sorted newest-first so the UI can show the most recent state.
        returns: {
          select: { id: true, returnNumber: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countMasterOrders(where: Prisma.MasterOrderWhereInput): Promise<number> {
    return this.prisma.masterOrder.count({ where });
  }

  async findMasterOrderById(id: string): Promise<any | null> {
    return this.prisma.masterOrder.findUnique({
      where: { id },
      include: { subOrders: { include: { items: true } } },
    });
  }

  async findMasterOrderByIdWithDetails(id: string): Promise<any | null> {
    return this.prisma.masterOrder.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        subOrders: {
          include: {
            items: true,
            commissionRecords: true,
            seller: {
              select: {
                id: true,
                sellerName: true,
                sellerShopName: true,
                email: true,
              },
            },
            // Sub-orders routed to a franchise carry franchiseId instead of
            // sellerId. Include the franchise so the order detail UI can
            // show the assignee's name regardless of node type.
            franchise: {
              select: {
                id: true,
                businessName: true,
                status: true,
                warehousePincode: true,
              },
            },
          },
        },
      },
    });
  }

  async findMasterOrderByCustomer(
    orderNumber: string,
    customerId: string,
  ): Promise<any | null> {
    return this.prisma.masterOrder.findFirst({
      where: { orderNumber, customerId },
      include: {
        subOrders: {
          include: { items: true },
        },
      },
    });
  }

  /**
   * Phase 197 (My-Orders audit #7) — map a customer status bucket to a
   * Prisma WHERE fragment. The buckets mirror the storefront's derived
   * labels so the server-side filter and the client badge agree:
   *   • cancelled — orderStatus CANCELLED/REJECTED OR a terminal-cancel
   *     paymentStatus (CANCELLED/EXPIRED/VOIDED).
   *   • delivered — orderStatus DELIVERED.
   *   • active    — neither of the above (NOT cancelled, NOT delivered).
   *   • all (or undefined) — no extra predicate.
   * Returns {} for `all` so callers can spread it unconditionally.
   */
  private customerBucketWhere(
    bucket?: 'all' | 'active' | 'delivered' | 'cancelled',
  ): any {
    const cancelledClause = {
      OR: [
        { orderStatus: { in: ['CANCELLED', 'REJECTED'] as any } },
        { paymentStatus: { in: ['CANCELLED', 'EXPIRED', 'VOIDED'] as any } },
      ],
    };
    switch (bucket) {
      case 'cancelled':
        return cancelledClause;
      case 'delivered':
        return {
          orderStatus: 'DELIVERED' as any,
          NOT: cancelledClause,
        };
      case 'active':
        return {
          NOT: {
            OR: [{ orderStatus: 'DELIVERED' as any }, cancelledClause],
          },
        };
      default:
        return {};
    }
  }

  async findCustomerOrders(
    customerId: string,
    skip: number,
    take: number,
    bucket?: 'all' | 'active' | 'delivered' | 'cancelled',
  ): Promise<any[]> {
    return this.prisma.masterOrder.findMany({
      where: { customerId, ...this.customerBucketWhere(bucket) },
      include: {
        subOrders: {
          include: { items: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countCustomerOrders(
    customerId: string,
    bucket?: 'all' | 'active' | 'delivered' | 'cancelled',
  ): Promise<number> {
    return this.prisma.masterOrder.count({
      where: { customerId, ...this.customerBucketWhere(bucket) },
    });
  }

  /**
   * Phase 197 (My-Orders audit #7) — per-bucket counts in one round
   * trip so the listing response can render accurate tab badges
   * regardless of which page the customer is on. Returns the count for
   * every bucket plus the grand total.
   */
  async countCustomerOrdersByBucket(customerId: string): Promise<{
    all: number;
    active: number;
    delivered: number;
    cancelled: number;
  }> {
    const [all, active, delivered, cancelled] = await Promise.all([
      this.countCustomerOrders(customerId, 'all'),
      this.countCustomerOrders(customerId, 'active'),
      this.countCustomerOrders(customerId, 'delivered'),
      this.countCustomerOrders(customerId, 'cancelled'),
    ]);
    return { all, active, delivered, cancelled };
  }

  async updateMasterOrder(id: string, data: any): Promise<any> {
    return this.prisma.masterOrder.update({ where: { id }, data });
  }

  // ── Sub-Order queries ──────────────────────────────────────────────────

  async findSubOrderById(id: string): Promise<any | null> {
    return this.prisma.subOrder.findUnique({ where: { id } });
  }

  async findSubOrderByIdWithItems(id: string): Promise<any | null> {
    return this.prisma.subOrder.findUnique({
      where: { id },
      include: {
        items: true,
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            orderStatus: true,
            shippingAddressSnapshot: true,
          },
        },
      },
    });
  }

  async findSubOrderByIdWithMasterOrder(id: string): Promise<any | null> {
    return this.prisma.subOrder.findUnique({
      where: { id },
      include: {
        masterOrder: { include: { subOrders: true } },
      },
    });
  }

  async findSubOrderByTrackingNumber(
    trackingNumber: string,
  ): Promise<any | null> {
    // Match the carrier AWB against the sub-order's tracking number.
    // findFirst stays defensive against historical reuse. Phase 82
    // added a partial unique index on tracking_number so collisions
    // are now blocked at the DB layer.
    return this.prisma.subOrder.findFirst({
      where: { trackingNumber },
      include: {
        masterOrder: { include: { subOrders: true } },
      },
    });
  }

  async findSubOrderForSeller(
    id: string,
    sellerId: string,
  ): Promise<any | null> {
    const routedOrLaterStatuses = [
      'ROUTED_TO_SELLER',
      'SELLER_ACCEPTED',
      'DISPATCHED',
      'DELIVERED',
    ] as const;

    return this.prisma.subOrder.findFirst({
      where: {
        id,
        sellerId,
        masterOrder: {
          orderStatus: { in: [...routedOrLaterStatuses] },
        },
      },
      include: {
        items: true,
        commissionRecords: true,
        // Surface returns + the items inside each return so the seller
        // detail page can show "Customer returned X of item Y" inline
        // instead of the seller having to hunt for it on the returns app.
        returns: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              select: {
                id: true,
                orderItemId: true,
                quantity: true,
                reasonCategory: true,
                reasonDetail: true,
                qcOutcome: true,
                qcQuantityApproved: true,
                refundAmount: true,
              },
            },
          },
        },
        masterOrder: {
          select: {
            orderNumber: true,
            orderStatus: true,
            shippingAddressSnapshot: true,
            paymentMethod: true,
            createdAt: true,
            customer: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  async findSubOrderForSellerBasic(
    id: string,
    sellerId: string,
  ): Promise<any | null> {
    return this.prisma.subOrder.findFirst({
      where: { id, sellerId },
      select: {
        id: true,
        acceptStatus: true,
        fulfillmentStatus: true,
        masterOrderId: true,
      },
    });
  }

  async findSubOrderForSellerWithDetails(
    id: string,
    sellerId: string,
  ): Promise<any | null> {
    return this.prisma.subOrder.findFirst({
      where: { id, sellerId },
      include: {
        items: true,
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            shippingAddressSnapshot: true,
            customerId: true,
          },
        },
      },
    });
  }

  async findSellerSubOrders(
    where: Prisma.SubOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<any[]> {
    return this.prisma.subOrder.findMany({
      where,
      include: {
        items: true,
        masterOrder: {
          select: {
            orderNumber: true,
            orderStatus: true,
            paymentMethod: true,
            createdAt: true,
            shippingAddressSnapshot: true,
            customer: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        // Surface returns on the seller orders list so the FULFILLMENT
        // column can flip to "Return Requested / Refunded" whenever the
        // customer opens a return. Sellers can't act on returns (admin
        // owns that flow), but they need visibility here.
        returns: {
          select: { id: true, returnNumber: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countSellerSubOrders(
    where: Prisma.SubOrderWhereInput,
  ): Promise<number> {
    return this.prisma.subOrder.count({ where });
  }

  async findSubOrdersByMasterOrder(
    masterOrderId: string,
  ): Promise<any[]> {
    return this.prisma.subOrder.findMany({
      where: { masterOrderId },
      select: { sellerId: true, acceptStatus: true },
    });
  }

  async updateSubOrder(id: string, data: any): Promise<any> {
    return this.prisma.subOrder.update({ where: { id }, data });
  }

  async createSubOrder(data: any): Promise<any> {
    return this.prisma.subOrder.create({ data });
  }

  // ── Reassignment logs ──────────────────────────────────────────────────

  /**
   * Phase 79 (2026-05-22) — history audit Gaps #7/#10/#15/#20.
   *   • Typed `ReassignmentLogEntity` return shape (Gap #7)
   *   • Cursor pagination via `before` (Gap #10)
   *   • Optional `from` / `to` time-range filter (Gap #15)
   *   • Optional `eventType` filter (Gap #6)
   *   • Deterministic ordering: `createdAt DESC, id ASC` — millisecond
   *     ties never flap between page loads (Gap #20)
   */
  async findReassignmentLogs(
    masterOrderId: string,
    opts: ReassignmentLogQueryOptions = {},
  ): Promise<ReassignmentLogEntity[]> {
    const limit = Math.min(
      Math.max(1, opts.limit ?? DEFAULT_REASSIGNMENT_PAGE_SIZE),
      MAX_REASSIGNMENT_PAGE_SIZE,
    );
    const where: Prisma.OrderReassignmentLogWhereInput = { masterOrderId };
    if (opts.from || opts.to || opts.before) {
      where.createdAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
        ...(opts.before ? { lt: opts.before } : {}),
      };
    }
    if (opts.eventType) {
      where.eventType = opts.eventType as any;
    }
    const rows = await this.prisma.orderReassignmentLog.findMany({
      where,
      // Deterministic tiebreak — see Gap #20. The composite
      // (master_order_id, created_at DESC, id) index in the
      // 20260522220000 migration serves both keys.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => this.toReassignmentLogEntity(r));
  }

  async countReassignmentLogs(
    masterOrderId: string,
    opts: Pick<ReassignmentLogQueryOptions, 'from' | 'to' | 'eventType'> = {},
  ): Promise<number> {
    const where: Prisma.OrderReassignmentLogWhereInput = { masterOrderId };
    if (opts.from || opts.to) {
      where.createdAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    if (opts.eventType) {
      where.eventType = opts.eventType as any;
    }
    return this.prisma.orderReassignmentLog.count({ where });
  }

  async createReassignmentLog(data: any): Promise<any> {
    return this.prisma.orderReassignmentLog.create({ data });
  }

  // Convert the Prisma row (which has `Date` createdAt + the enum) into
  // the repo-level entity shape. The narrowing is exactly the typed
  // contract the controller / UI consume.
  private toReassignmentLogEntity(r: any): ReassignmentLogEntity {
    return {
      id: r.id,
      subOrderId: r.subOrderId,
      masterOrderId: r.masterOrderId,
      fromNodeType: r.fromNodeType as ReassignmentNodeType,
      fromNodeId: r.fromNodeId ?? null,
      toNodeType: r.toNodeType as ReassignmentNodeType,
      toNodeId: r.toNodeId ?? null,
      fromSellerId: r.fromSellerId,
      toSellerId: r.toSellerId ?? null,
      reason: r.reason,
      failureReason: r.failureReason ?? null,
      successful: r.successful,
      newSubOrderId: r.newSubOrderId ?? null,
      reassignedBy: r.reassignedBy ?? null,
      reassignmentSequence: r.reassignmentSequence,
      eventType: r.eventType as ReassignmentEventType,
      createdAt: r.createdAt,
    };
  }

  // ── Stock & reservation helpers ────────────────────────────────────────

  async findSeller(id: string): Promise<any | null> {
    return this.prisma.seller.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        sellerName: true,
        sellerShopName: true,
      },
    });
  }

  async findSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null> {
    return this.prisma.sellerProductMapping.findFirst({
      where: {
        sellerId,
        productId,
        ...(variantId ? { variantId } : { variantId: null }),
        isActive: true,
        approvalStatus: 'APPROVED',
      },
    });
  }

  async findSellerProductMappingIds(
    productId: string,
    variantId: string | null,
    sellerIds: string[],
  ): Promise<string[]> {
    const mappings = await this.prisma.sellerProductMapping.findMany({
      where: {
        productId,
        variantId,
        sellerId: { in: sellerIds },
      },
      select: { id: true },
    });
    return mappings.map((m) => m.id);
  }

  async findStockReservations(
    orderId: string,
    sellerId: string,
  ): Promise<any[]> {
    return this.prisma.stockReservation.findMany({
      where: {
        orderId,
        status: { in: ['RESERVED', 'CONFIRMED'] },
        mapping: { sellerId },
      },
    });
  }

  async releaseReservation(reservationId: string): Promise<void> {
    await this.prisma.stockReservation.update({
      where: { id: reservationId },
      data: { status: 'RELEASED' },
    });
  }

  async restoreStockFromConfirmedReservation(
    reservationId: string,
    mappingId: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.stockReservation.update({
      where: { id: reservationId },
      data: { status: 'RELEASED' },
    });
    await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: { stockQty: { increment: quantity } },
    });
  }

  async releaseReservedStock(
    reservationId: string,
    mappingId: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.stockReservation.update({
      where: { id: reservationId },
      data: { status: 'RELEASED' },
    });
    await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: { reservedQty: { decrement: quantity } },
    });
  }

  async createStockReservation(data: any): Promise<any> {
    return this.prisma.stockReservation.create({ data });
  }

  async incrementMappingReservedQty(
    mappingId: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: { reservedQty: { increment: quantity } },
    });
  }

  // ── Product stock restore ──────────────────────────────────────────────

  async incrementVariantStock(
    variantId: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: { increment: quantity } },
    });
  }

  async incrementProductStock(
    productId: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { baseStock: { increment: quantity } },
    });
  }

  // ── Allocation log ─────────────────────────────────────────────────────

  async createAllocationLog(data: any): Promise<void> {
    await this.prisma.allocationLog.create({ data });
  }

  // Phase 80 (2026-05-22) — acceptance audit Gap #2. The legacy
  // findExpiredSubOrders method was deleted with OrderTimeoutService.
  // The unified OrderAcceptanceSlaProcessor queries SubOrder directly
  // with the (acceptStatus, fulfillmentNodeType, acceptDeadlineAt)
  // composite index added in the 20260522230000 migration.

  // ── Transaction support ────────────────────────────────────────────────

  async executeTransaction<T = void>(
    fn: (tx: any) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      return fn(tx);
    });
  }
}
