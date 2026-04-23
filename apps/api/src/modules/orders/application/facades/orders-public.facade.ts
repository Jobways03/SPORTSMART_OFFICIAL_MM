import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { OrdersService } from '../services/orders.service';
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
  async findDeliveredSubOrdersPastReturnWindow() {
    return this.prisma.subOrder.findMany({
      where: {
        fulfillmentStatus: 'DELIVERED',
        commissionProcessed: false,
        returnWindowEndsAt: { lt: new Date() },
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
      data: {
        acceptStatus: 'REJECTED',
        fulfillmentStatus: 'CANCELLED',
        rejectionReason: reason,
        rejectionNote: note ?? null,
      },
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
      data: {
        fulfillmentStatus: data.fulfillmentStatus as any,
        trackingNumber: data.trackingNumber ?? undefined,
        courierName: data.courierName ?? undefined,
        shippingLabelUrl: data.shippingLabelUrl ?? undefined,
      },
    });
  }

  async markSubOrderDelivered(subOrderId: string) {
    return this.ordersService.deliverSubOrder(subOrderId);
  }

  async markSubOrderCommissionProcessed(subOrderId: string) {
    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: { commissionProcessed: true },
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
    return this.prisma.subOrder.create({
      data: {
        masterOrderId: data.masterOrderId,
        sellerId: data.sellerId ?? null,
        franchiseId: data.franchiseId ?? null,
        fulfillmentNodeType: data.fulfillmentNodeType,
        subTotal: data.subTotal,
        acceptDeadlineAt: data.acceptDeadlineAt ?? null,
        commissionRateSnapshot: data.commissionRateSnapshot ?? null,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            sku: item.sku ?? null,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle ?? null,
            masterSku: item.masterSku ?? null,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            imageUrl: item.imageUrl ?? null,
          })),
        },
      },
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
   * Get master order with delivered sub-orders and items.
   * Used by returns module for eligibility checks.
   */
  async getMasterOrderWithDeliveredSubOrders(masterOrderId: string, customerId: string) {
    return this.prisma.masterOrder.findFirst({
      where: { id: masterOrderId, customerId },
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
