import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { AdminAuthGuard } from '../../../core/guards';
import { BadRequestAppException, NotFoundAppException } from '../../../core/exceptions';
import { Prisma } from '@prisma/client';

@ApiTags('Admin Orders')
@Controller('admin/orders')
@UseGuards(AdminAuthGuard)
export class AdminOrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.MasterOrderWhereInput = {};

    if (paymentStatus) {
      where.paymentStatus = paymentStatus as any;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    // Sub-order level filters
    const subOrderFilter: Prisma.SubOrderWhereInput = {};
    if (fulfillmentStatus) {
      subOrderFilter.fulfillmentStatus = fulfillmentStatus as any;
    }
    if (acceptStatus) {
      subOrderFilter.acceptStatus = acceptStatus as any;
    }

    if (Object.keys(subOrderFilter).length > 0) {
      where.subOrders = { some: subOrderFilter };
    }

    const [orders, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where,
        include: {
          customer: {
            select: { firstName: true, lastName: true, email: true },
          },
          subOrders: {
            include: {
              items: true,
              seller: { select: { sellerShopName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    return {
      success: true,
      message: 'Orders retrieved',
      data: {
        orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':id')
  async getOrder(@Param('id') id: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: {
        customer: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        subOrders: {
          include: {
            items: true,
            commissionRecords: true,
            seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundAppException('Order not found');
    }

    return { success: true, message: 'Order retrieved', data: order };
  }

  @Patch(':id/verify')
  async verifyOrder(@Param('id') id: string) {
    const order = await this.prisma.masterOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.verified) throw new BadRequestAppException('Order is already verified');
    if (order.paymentStatus === 'CANCELLED') throw new BadRequestAppException('Cannot verify a cancelled order');

    const updated = await this.prisma.masterOrder.update({
      where: { id },
      data: { verified: true, verifiedAt: new Date() },
    });

    return { success: true, message: 'Order verified successfully', data: updated };
  }

  @Patch(':id/reject-order')
  async rejectOrder(@Param('id') id: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: { subOrders: { include: { items: true } } },
    });
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.verified) throw new BadRequestAppException('Cannot reject a verified order');
    if (order.paymentStatus === 'CANCELLED') throw new BadRequestAppException('Order is already cancelled');

    await this.prisma.$transaction(async (tx) => {
      // Cancel master order
      await tx.masterOrder.update({
        where: { id },
        data: { paymentStatus: 'CANCELLED' },
      });

      // Cancel all sub-orders and restore stock
      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: {
            paymentStatus: 'CANCELLED',
            acceptStatus: 'REJECTED',
            commissionProcessed: true,
          },
        });

        for (const item of so.items) {
          if (item.variantId) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          } else {
            await tx.product.update({
              where: { id: item.productId },
              data: { baseStock: { increment: item.quantity } },
            });
          }
        }
      }
    });

    return { success: true, message: 'Order rejected and cancelled — stock restored' };
  }

  @Patch('sub-orders/:id/accept')
  async acceptSubOrder(@Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: { acceptStatus: 'ACCEPTED' },
    });

    return { success: true, message: 'Sub-order accepted', data: updated };
  }

  @Patch('sub-orders/:id/reject')
  async rejectSubOrder(@Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: { acceptStatus: 'REJECTED' },
    });

    return { success: true, message: 'Sub-order rejected', data: updated };
  }

  @Patch('sub-orders/:id/fulfill')
  async fulfillSubOrder(@Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: { fulfillmentStatus: 'FULFILLED' },
    });

    return { success: true, message: 'Sub-order fulfilled', data: updated };
  }

  @Patch('sub-orders/:id/deliver')
  async deliverSubOrder(@Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const RETURN_WINDOW_MS = 60 * 1000; // 1 minute for testing
    const now = new Date();
    const returnWindowEndsAt = new Date(now.getTime() + RETURN_WINDOW_MS);

    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: {
        fulfillmentStatus: 'DELIVERED',
        deliveredAt: now,
        returnWindowEndsAt,
      },
    });

    return { success: true, message: 'Sub-order marked as delivered — return window started', data: updated };
  }

  @Patch(':id/mark-paid')
  async markAsPaid(@Param('id') id: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: { subOrders: true },
    });
    if (!order) throw new NotFoundAppException('Order not found');

    // Update master order and all sub-orders
    await this.prisma.$transaction([
      this.prisma.masterOrder.update({
        where: { id },
        data: { paymentStatus: 'PAID' },
      }),
      ...order.subOrders.map((so) =>
        this.prisma.subOrder.update({
          where: { id: so.id },
          data: { paymentStatus: 'PAID' },
        }),
      ),
    ]);

    return { success: true, message: 'Order marked as paid' };
  }
}
