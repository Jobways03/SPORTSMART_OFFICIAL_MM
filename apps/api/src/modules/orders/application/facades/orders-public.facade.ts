import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { OrdersService } from '../services/orders.service';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import {
  ORDER_REPOSITORY,
  OrderRepository,
} from '../../domain/repositories/order.repository.interface';

/**
 * OrdersPublicFacade — the ONLY entry point for other modules to interact
 * with orders data. No module should import PrismaService to query
 * masterOrder / subOrder / orderItem directly.
 */
@Injectable()
export class OrdersPublicFacade {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly prisma: PrismaService,
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepo: OrderRepository,
    // Phase 7 (PR 7.8) — paise-sibling dual-write at the facade
    // boundary; the four subOrder writes here are 3 status-only
    // updates (helper no-ops) + 1 create with subTotal + nested
    // orderItem rows that need their own paise transforms.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
  ) {}

  // ── Read: Master Order ────────────────────────────────────

  async getOrder(id: string) {
    return this.ordersService.getOrder(id);
  }

  async getMasterOrder(id: string) {
    return this.prisma.masterOrder.findUnique({
      where: { id },
      include: { customer: { select: { email: true, firstName: true, lastName: true } } },
    });
  }

  async getMasterOrderBasic(id: string) {
    return this.prisma.masterOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        totalAmount: true,
        // Phase 0 (PR 0.1) — paise sibling needed by PaymentsPublicFacade
        // to compare the gateway-reported captured amount against the
        // platform's expected order total. The Decimal `totalAmount`
        // above is preserved for callers in the soak window.
        totalAmountInPaise: true,
        // Phase 0 (PR 0.1) — needed so the payments facade can assert the
        // gateway's payment.order_id matches the razorpay_order_id we
        // minted at checkout. Without this, a payment captured against
        // a different order could be applied here.
        razorpayOrderId: true,
        paymentMethod: true,
        paymentStatus: true,
        orderStatus: true,
        verified: true,
        itemCount: true,
        createdAt: true,
      },
    });
  }

  async listOrders(filters: {
    page: number;
    limit: number;
    paymentStatus?: string;
    fulfillmentStatus?: string;
    acceptStatus?: string;
    orderStatus?: string;
    search?: string;
  }) {
    return this.ordersService.listOrders(filters);
  }

  // ── Read: Sub Order ───────────────────────────────────────

  async getSubOrder(id: string) {
    return this.prisma.subOrder.findUnique({
      where: { id },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true, customerId: true, shippingAddressSnapshot: true, orderStatus: true } },
      },
    });
  }

  async getSubOrderBasic(id: string) {
    return this.prisma.subOrder.findUnique({
      where: { id },
      select: {
        id: true,
        masterOrderId: true,
        sellerId: true,
        franchiseId: true,
        fulfillmentNodeType: true,
        subTotal: true,
        fulfillmentStatus: true,
        acceptStatus: true,
        paymentStatus: true,
        acceptDeadlineAt: true,
        deliveredAt: true,
        returnWindowEndsAt: true,
        trackingNumber: true,
        courierName: true,
        commissionProcessed: true,
        commissionRateSnapshot: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findSubOrderByTrackingNumber(trackingNumber: string) {
    return this.orderRepo.findSubOrderByTrackingNumber(trackingNumber);
  }

  /**
   * Phase 4 (PR 4.4) — atomically claim a tracking event for a
   * sub-order if its timestamp is newer than the last recorded one.
   *
   * Uses a status-conditional `updateMany`: the row's
   * `lastTrackingEventAt` must be either NULL or earlier than the
   * incoming `eventTimestamp` for the update to land. The Postgres
   * predicate is the canonical place to enforce the invariant — two
   * concurrent webhook deliveries for the same AWB serialise at the
   * row, and only the newer-timestamp request wins `count === 1`.
   * The loser sees `count === 0` and drops its event as out-of-order.
   *
   * Returns true iff this caller's event was accepted (and the
   * timestamp persisted).
   */
  async claimTrackingEvent(
    subOrderId: string,
    eventTimestamp: Date,
  ): Promise<boolean> {
    const result = await this.prisma.subOrder.updateMany({
      where: {
        id: subOrderId,
        OR: [
          { lastTrackingEventAt: null },
          { lastTrackingEventAt: { lt: eventTimestamp } },
        ],
      },
      data: { lastTrackingEventAt: eventTimestamp },
    });
    return result.count === 1;
  }

  async findSubOrdersForNode(params: {
    nodeType: 'SELLER' | 'FRANCHISE';
    nodeId: string;
    page?: number;
    limit?: number;
    fulfillmentStatus?: string;
    acceptStatus?: string;
  }) {
    const where: any = {};
    if (params.nodeType === 'SELLER') where.sellerId = params.nodeId;
    else where.franchiseId = params.nodeId;
    if (params.fulfillmentStatus) where.fulfillmentStatus = params.fulfillmentStatus;
    if (params.acceptStatus) where.acceptStatus = params.acceptStatus;

    const page = params.page || 1;
    const limit = params.limit || 20;

    const [subOrders, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        include: {
          items: true,
          masterOrder: {
            select: { id: true, orderNumber: true, customerId: true, shippingAddressSnapshot: true, orderStatus: true },
            include: { customer: { select: { firstName: true, lastName: true, email: true } } },
          },
          // Surface returns so the seller-facing and franchise-facing
          // orders lists can flip their "order status" column when a
          // customer opens a return.
          returns: {
            select: { id: true, returnNumber: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subOrder.count({ where }),
    ]);

    return { subOrders, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Find delivered sub-orders past return window with commission not yet processed.
   * Used by commission processor background jobs.
   */
  async findDeliveredSubOrdersPastReturnWindow(limit = 200) {
    return this.prisma.subOrder.findMany({
      // Phase 135 — bound the per-tick scan. Without `take`, a backlog after a
      // processor outage would load the entire matching set + nested
      // items/seller/order joins in one query (OOM + lock-TTL-overrun risk).
      // `orderBy` drains oldest-first (FIFO) with a stable id tiebreaker so
      // successive ticks make deterministic forward progress.
      take: limit,
      orderBy: [{ returnWindowEndsAt: 'asc' }, { id: 'asc' }],
      where: {
        fulfillmentStatus: 'DELIVERED',
        commissionProcessed: false,
        // Phase 83 (2026-05-23) — delivery audit Gap #2. The cron now
        // filters by `commissionLockScheduledAt <= now()` which is set
        // at delivery time to `returnWindowEndsAt`. Pre-Phase-83 the
        // filter was `returnWindowEndsAt < now()` which forced the
        // cron to scan all delivered-but-unprocessed rows every tick.
        // The new column has a dedicated index. Backfill in the
        // 20260523020000 migration sets it for legacy rows so the
        // filter behaves identically without a code-side fallback.
        OR: [
          { commissionLockScheduledAt: { lte: new Date() } },
          // Belt-and-braces — also pick up legacy rows where the
          // column may be null (pre-Phase-83 backfill missed them).
          {
            AND: [
              { commissionLockScheduledAt: null },
              { returnWindowEndsAt: { lt: new Date() } },
            ],
          },
        ],
        // Skip sub-orders that have a live return. If the return is
        // already terminally-failed (admin rejected it, QC rejected it,
        // or the customer cancelled), commission can still be locked.
        // Everything else — REQUESTED, APPROVED, IN_TRANSIT, RECEIVED,
        // QC_APPROVED, PARTIALLY_APPROVED, REFUND_PROCESSING, REFUNDED,
        // COMPLETED — means the money is either already being refunded
        // or soon will be, so we must not double-count.
        NOT: {
          returns: {
            some: {
              status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] },
            },
          },
        },
        // Phase 136 — also skip sub-orders with an ACTIVE dispute. A customer
        // can open a dispute (e.g. WRONG_ITEM_RECEIVED) without filing a
        // return; locking commission at the return window would let payout go
        // out while the dispute is still being adjudicated. Terminal disputes
        // (RESOLVED_*/CLOSED) don't block.
        disputes: {
          none: {
            status: {
              notIn: [
                'RESOLVED_BUYER',
                'RESOLVED_SELLER',
                'RESOLVED_SPLIT',
                'CLOSED',
              ],
            },
          },
        },
      },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true } },
        seller: { select: { id: true, sellerName: true, sellerShopName: true } },
      },
    });
  }

  /**
   * Single-sub-order variant for the immediate-commission path. Used
   * when a return reaches a terminal-rejected state (REJECTED /
   * QC_REJECTED / CANCELLED) — the cron's deliveredAt-window gate is
   * irrelevant at that point because the customer's claim is already
   * final, so we want commission to lock now instead of waiting out
   * the remaining window. Returns null when the sub-order is missing,
   * not delivered, already processed, or still has a non-terminal
   * return that would otherwise block commission.
   *
   * Same shape as findDeliveredSubOrdersPastReturnWindow so the
   * processor can reuse one record-builder.
   */
  async findSubOrderForImmediateCommission(subOrderId: string) {
    return this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        fulfillmentStatus: 'DELIVERED',
        commissionProcessed: false,
        // No returnWindowEndsAt filter — the whole point of this path
        // is to bypass it.
        NOT: {
          returns: {
            some: {
              status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] },
            },
          },
        },
        // Phase 136 — an active dispute blocks the immediate lock too (a
        // rejected return doesn't mean the dispute is resolved).
        disputes: {
          none: {
            status: {
              notIn: [
                'RESOLVED_BUYER',
                'RESOLVED_SELLER',
                'RESOLVED_SPLIT',
                'CLOSED',
              ],
            },
          },
        },
      },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true } },
        seller: { select: { id: true, sellerName: true, sellerShopName: true } },
      },
    });
  }

  /**
   * Find delivered franchise sub-orders past return window.
   */
  async findDeliveredFranchiseSubOrdersPastReturnWindow() {
    return this.prisma.subOrder.findMany({
      where: {
        fulfillmentNodeType: 'FRANCHISE',
        fulfillmentStatus: 'DELIVERED',
        commissionProcessed: false,
        returnWindowEndsAt: { lt: new Date() },
        franchiseId: { not: null },
        NOT: {
          returns: {
            some: {
              status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] },
            },
          },
        },
      },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true } },
      },
    });
  }

  async countSubOrdersForNode(nodeType: 'SELLER' | 'FRANCHISE', nodeId: string, where?: any) {
    const baseWhere: any = { ...where };
    if (nodeType === 'SELLER') baseWhere.sellerId = nodeId;
    else baseWhere.franchiseId = nodeId;
    return this.prisma.subOrder.count({ where: baseWhere });
  }

  /**
   * Find rejected sub-orders for a master order (used in reassignment logic).
   */
  async findRejectedSubOrders(masterOrderId: string) {
    return this.prisma.subOrder.findMany({
      where: { masterOrderId, acceptStatus: 'REJECTED' },
      select: { id: true, sellerId: true, franchiseId: true, fulfillmentNodeType: true },
    });
  }

  /**
   * Find stale sub-orders for a node (past accept deadline).
   */
  async findStaleSubOrders(nodeType: 'SELLER' | 'FRANCHISE', nodeId: string) {
    const where: any = {
      acceptStatus: 'OPEN',
      acceptDeadlineAt: { lt: new Date() },
    };
    if (nodeType === 'SELLER') where.sellerId = nodeId;
    else where.franchiseId = nodeId;

    return this.prisma.subOrder.findMany({ where, include: { items: true } });
  }

  // ── Write: Sub Order ──────────────────────────────────────

  async acceptSubOrder(subOrderId: string, expectedDispatchDate?: Date) {
    const updated = await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        acceptStatus: 'ACCEPTED',
        expectedDispatchDate: expectedDispatchDate ?? null,
      },
    });

    // Update master order status
    await this.prisma.masterOrder.update({
      where: { id: updated.masterOrderId },
      data: { orderStatus: 'SELLER_ACCEPTED' },
    });

    return updated;
  }

  async rejectSubOrder(subOrderId: string, reason: string, note?: string) {
    return this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: this.moneyDualWrite.applyPaise('subOrder', {
        acceptStatus: 'REJECTED' as const,
        fulfillmentStatus: 'CANCELLED' as const,
        rejectionReason: reason,
        rejectionNote: note ?? null,
      }),
    });
  }

  async updateSubOrderFulfillment(subOrderId: string, data: {
    fulfillmentStatus: string;
    trackingNumber?: string;
    courierName?: string;
    shippingLabelUrl?: string;
  }) {
    return this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: this.moneyDualWrite.applyPaise('subOrder', {
        fulfillmentStatus: data.fulfillmentStatus as any,
        trackingNumber: data.trackingNumber ?? undefined,
        courierName: data.courierName ?? undefined,
        shippingLabelUrl: data.shippingLabelUrl ?? undefined,
      }),
    });
  }

  /**
   * Phase 83 (2026-05-23) — delivery confirmation audit Gap #3.
   * Webhook callers thread their source + actor surrogate through so
   * the SubOrder row records WEBHOOK_SHIPROCKET and the audit_log row
   * carries the correct actorRole=SYSTEM.
   */
  async markSubOrderDelivered(
    subOrderId: string,
    opts?: {
      source?:
        | 'WEBHOOK_SHIPROCKET'
        | 'WEBHOOK_DELHIVERY'
        | 'MANUAL_ADMIN'
        | 'MANUAL_FRANCHISE';
      deliveredBy?: string;
      deliveryProofUrl?: string;
      deliveryOtpVerified?: boolean;
      deliverySignatureUrl?: string;
    },
  ) {
    return this.ordersService.deliverSubOrder(subOrderId, opts);
  }

  async markSubOrderCommissionProcessed(subOrderId: string) {
    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: this.moneyDualWrite.applyPaise('subOrder', {
        commissionProcessed: true,
      }),
    });
  }

  async createSubOrder(data: {
    masterOrderId: string;
    sellerId?: string;
    franchiseId?: string;
    fulfillmentNodeType: string;
    subTotal: number;
    acceptDeadlineAt?: Date;
    commissionRateSnapshot?: number;
    items: Array<{
      productId: string;
      variantId?: string;
      sku?: string;
      productTitle: string;
      variantTitle?: string;
      masterSku?: string;
      unitPrice: number;
      quantity: number;
      totalPrice: number;
      imageUrl?: string;
    }>;
  }) {
    // Nested orderItems need their own paise transforms — the helper
    // only walks top-level keys on the modelKey it was given, so the
    // outer applyPaise('subOrder', ...) covers subTotal/subTotalInPaise
    // but the nested `items.create` array bypasses it. applyPaiseMany
    // handles each orderItem row (unitPrice/totalPrice → paise siblings).
    // .toFixed(2) is defensive: input.subTotal / item prices arrive as
    // JS Numbers that may be fractional after cart arithmetic, and
    // toPaise refuses fractional Numbers (PR 0.4 contract).
    const orderItems = this.moneyDualWrite.applyPaiseMany(
      'orderItem',
      data.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        sku: item.sku ?? null,
        productTitle: item.productTitle,
        variantTitle: item.variantTitle ?? null,
        masterSku: item.masterSku ?? null,
        unitPrice: Number(item.unitPrice).toFixed(2),
        quantity: item.quantity,
        totalPrice: Number(item.totalPrice).toFixed(2),
        imageUrl: item.imageUrl ?? null,
      })),
    );
    return this.prisma.subOrder.create({
      data: this.moneyDualWrite.applyPaise('subOrder', {
        masterOrderId: data.masterOrderId,
        sellerId: data.sellerId ?? null,
        franchiseId: data.franchiseId ?? null,
        fulfillmentNodeType: data.fulfillmentNodeType,
        subTotal: Number(data.subTotal).toFixed(2),
        acceptDeadlineAt: data.acceptDeadlineAt ?? null,
        commissionRateSnapshot: data.commissionRateSnapshot ?? null,
        items: {
          create: orderItems,
        },
      }),
      include: { items: true },
    });
  }

  // ── Write: Master Order ───────────────────────────────────

  async updateMasterOrderStatus(masterOrderId: string, orderStatus: string) {
    return this.prisma.masterOrder.update({
      where: { id: masterOrderId },
      data: { orderStatus: orderStatus as any },
    });
  }

  async updatePaymentStatus(masterOrderId: string, paymentStatus: string) {
    const updated = await this.prisma.masterOrder.update({
      where: { id: masterOrderId },
      data: { paymentStatus: paymentStatus as any },
    });

    // Also update all sub-orders if marking PAID
    if (paymentStatus === 'PAID') {
      await this.prisma.subOrder.updateMany({
        where: { masterOrderId, acceptStatus: { not: 'REJECTED' } },
        data: { paymentStatus: 'PAID' },
      });
    }

    return updated;
  }

  /**
   * Phase 0 (PR 0.12) — conditional flip of `paymentStatus` to close
   * the TOCTOU window between `getMasterOrderBasic` and the prior
   * `updatePaymentStatus` call. Only flips when the current status is
   * in `from`, and reports `{ flipped }` so the caller can decide
   * whether to fan out (event publish, side-effects). Concurrent
   * webhook deliveries both hitting `flipPaymentStatusIfFrom` produce
   * exactly one `flipped=true` and one `flipped=false`.
   *
   * Returns the freshly-loaded row regardless of the flip outcome so
   * the caller can introspect (e.g. emit "already PAID" log line).
   */
  async flipPaymentStatusIfFrom(
    masterOrderId: string,
    from: string[],
    to: string,
  ): Promise<{
    flipped: boolean;
    order: { id: string; paymentStatus: string } | null;
  }> {
    const result = await this.prisma.masterOrder.updateMany({
      where: {
        id: masterOrderId,
        paymentStatus: { in: from as any },
      },
      data: { paymentStatus: to as any },
    });

    // Mirror the side-effect of `updatePaymentStatus` on the PAID path —
    // sub-orders inherit the new status. Conditional on count > 0 so
    // we don't re-write on a stale loser.
    if (result.count > 0 && to === 'PAID') {
      await this.prisma.subOrder.updateMany({
        where: { masterOrderId, acceptStatus: { not: 'REJECTED' } },
        data: { paymentStatus: 'PAID' },
      });
    }

    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: { id: true, paymentStatus: true },
    });

    return { flipped: result.count > 0, order };
  }

  /**
   * Get master order with delivered sub-orders and items.
   * Used by returns module for eligibility checks.
   *
   * Phase 92 follow-up (2026-05-23) — Gap #16 facade refactor.
   * Accepts `excludeMasterStatuses` so the returns module's Phase 92
   * gap (cancelled/refunded master should NOT surface eligible
   * items) lands here instead of being re-implemented in the
   * eligibility service. Defaults to no exclusion for back-compat.
   */
  async getMasterOrderWithDeliveredSubOrders(
    masterOrderId: string,
    customerId: string,
    options?: { excludeMasterStatuses?: string[] },
  ) {
    return this.prisma.masterOrder.findFirst({
      where: {
        id: masterOrderId,
        customerId,
        ...(options?.excludeMasterStatuses
          ? { orderStatus: { notIn: options.excludeMasterStatuses as any } }
          : {}),
      },
      include: {
        subOrders: {
          where: { fulfillmentStatus: 'DELIVERED' },
          include: { items: true },
        },
      },
    });
  }

  /**
   * Get sub-order with items for return processing.
   */
  async getSubOrderForReturn(subOrderId: string) {
    return this.prisma.subOrder.findFirst({
      where: { id: subOrderId },
      include: {
        items: true,
        masterOrder: {
          select: { id: true, orderNumber: true, customerId: true, orderStatus: true },
        },
      },
    });
  }

  async getOrderPaymentStatus(masterOrderId: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: { id: true, paymentStatus: true, orderStatus: true, totalAmount: true },
    });
    return order;
  }
}
