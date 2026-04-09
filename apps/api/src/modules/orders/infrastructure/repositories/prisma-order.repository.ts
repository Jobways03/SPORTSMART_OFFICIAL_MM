import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { OrderRepository } from '../../domain/repositories/order.repository.interface';
import { Prisma } from '@prisma/client';

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

  async findCustomerOrders(
    customerId: string,
    skip: number,
    take: number,
  ): Promise<any[]> {
    return this.prisma.masterOrder.findMany({
      where: { customerId },
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

  async countCustomerOrders(customerId: string): Promise<number> {
    return this.prisma.masterOrder.count({ where: { customerId } });
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

  async findReassignmentLogs(masterOrderId: string): Promise<any[]> {
    return this.prisma.orderReassignmentLog.findMany({
      where: { masterOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createReassignmentLog(data: any): Promise<any> {
    return this.prisma.orderReassignmentLog.create({ data });
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

  // ── Expired sub-orders ─────────────────────────────────────────────────

  async findExpiredSubOrders(
    now: Date,
  ): Promise<{ id: string; sellerId: string }[]> {
    return this.prisma.subOrder.findMany({
      where: {
        acceptStatus: 'OPEN',
        acceptDeadlineAt: {
          not: null,
          lt: now,
        },
      },
      select: { id: true, sellerId: true },
    });
  }

  // ── Transaction support ────────────────────────────────────────────────

  async executeTransaction(
    fn: (tx: any) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await fn(tx);
    });
  }
}
