import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';

const RETURN_WINDOW_MS = 60 * 1000; // 1 minute for testing

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(filters: {
    page: number; limit: number;
    paymentStatus?: string; fulfillmentStatus?: string;
    acceptStatus?: string; search?: string;
  }) {
    const { page, limit, paymentStatus, fulfillmentStatus, acceptStatus, search } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.MasterOrderWhereInput = {};
    if (paymentStatus) where.paymentStatus = paymentStatus as any;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
      ];
    }

    const subOrderFilter: Prisma.SubOrderWhereInput = {};
    if (fulfillmentStatus) subOrderFilter.fulfillmentStatus = fulfillmentStatus as any;
    if (acceptStatus) subOrderFilter.acceptStatus = acceptStatus as any;
    if (Object.keys(subOrderFilter).length > 0) where.subOrders = { some: subOrderFilter };

    const [orders, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where,
        include: {
          customer: { select: { firstName: true, lastName: true, email: true } },
          subOrders: { include: { items: true, seller: { select: { sellerShopName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    return { orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getOrder(id: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
        subOrders: {
          include: {
            items: true,
            commissionRecords: true,
            seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundAppException('Order not found');
    return order;
  }

  async verifyOrder(id: string) {
    const order = await this.prisma.masterOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.verified) throw new BadRequestAppException('Order is already verified');
    if (order.paymentStatus === 'CANCELLED') throw new BadRequestAppException('Cannot verify a cancelled order');

    return this.prisma.masterOrder.update({
      where: { id },
      data: { verified: true, verifiedAt: new Date() },
    });
  }

  async rejectOrder(id: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: { subOrders: { include: { items: true } } },
    });
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.verified) throw new BadRequestAppException('Cannot reject a verified order');
    if (order.paymentStatus === 'CANCELLED') throw new BadRequestAppException('Order is already cancelled');

    await this.prisma.$transaction(async (tx) => {
      await tx.masterOrder.update({ where: { id }, data: { paymentStatus: 'CANCELLED' } });

      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: { paymentStatus: 'CANCELLED', acceptStatus: 'REJECTED', commissionProcessed: true },
        });

        for (const item of so.items) {
          if (item.variantId) {
            await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
          } else {
            await tx.product.update({ where: { id: item.productId }, data: { baseStock: { increment: item.quantity } } });
          }
        }
      }
    });
  }

  async acceptSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { acceptStatus: 'ACCEPTED' } });
  }

  async rejectSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { acceptStatus: 'REJECTED' } });
  }

  async fulfillSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { fulfillmentStatus: 'FULFILLED' } });
  }

  async deliverSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const now = new Date();
    return this.prisma.subOrder.update({
      where: { id },
      data: { fulfillmentStatus: 'DELIVERED', deliveredAt: now, returnWindowEndsAt: new Date(now.getTime() + RETURN_WINDOW_MS) },
    });
  }

  async markAsPaid(id: string) {
    const order = await this.prisma.masterOrder.findUnique({ where: { id }, include: { subOrders: true } });
    if (!order) throw new NotFoundAppException('Order not found');

    await this.prisma.$transaction([
      this.prisma.masterOrder.update({ where: { id }, data: { paymentStatus: 'PAID' } }),
      ...order.subOrders.map((so) => this.prisma.subOrder.update({ where: { id: so.id }, data: { paymentStatus: 'PAID' } })),
    ]);
  }

  // Seller-scoped methods
  async listSellerOrders(sellerId: string, page: number, limit: number) {
    const where = { sellerId, masterOrder: { verified: true } };
    const [subOrders, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        include: {
          items: true,
          masterOrder: { select: { orderNumber: true, paymentMethod: true, createdAt: true, customer: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subOrder.count({ where }),
    ]);
    return { subOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getSellerOrder(id: string, sellerId: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id, sellerId, masterOrder: { verified: true } },
      include: {
        items: true,
        commissionRecords: true,
        masterOrder: { select: { orderNumber: true, shippingAddressSnapshot: true, paymentMethod: true, createdAt: true, customer: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    return subOrder;
  }

  async sellerAcceptOrder(id: string, sellerId: string) {
    const subOrder = await this.prisma.subOrder.findFirst({ where: { id, sellerId } });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { acceptStatus: 'ACCEPTED' } });
  }

  async sellerRejectOrder(id: string, sellerId: string) {
    const subOrder = await this.prisma.subOrder.findFirst({ where: { id, sellerId } });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { acceptStatus: 'REJECTED' } });
  }
}
