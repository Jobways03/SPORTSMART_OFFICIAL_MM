import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { SellerAuthGuard } from '../../../core/guards';
import { NotFoundAppException } from '../../../core/exceptions';

@ApiTags('Seller Orders')
@Controller('seller/orders')
@UseGuards(SellerAuthGuard)
export class SellerOrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listOrders(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      sellerId: req.sellerId,
      masterOrder: { verified: true },
    };

    const [subOrders, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        include: {
          items: true,
          masterOrder: {
            select: {
              orderNumber: true,
              paymentMethod: true,
              createdAt: true,
              customer: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.subOrder.count({ where }),
    ]);

    return {
      success: true,
      message: 'Orders retrieved',
      data: {
        subOrders,
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
  async getOrder(@Req() req: any, @Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id, sellerId: req.sellerId, masterOrder: { verified: true } },
      include: {
        items: true,
        commissionRecords: true,
        masterOrder: {
          select: {
            orderNumber: true,
            shippingAddressSnapshot: true,
            paymentMethod: true,
            createdAt: true,
            customer: {
              select: { firstName: true, lastName: true, email: true },
            },
          },
        },
      },
    });

    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }

    return { success: true, message: 'Order retrieved', data: subOrder };
  }

  @Patch(':id/accept')
  async acceptOrder(@Req() req: any, @Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id, sellerId: req.sellerId },
    });
    if (!subOrder) throw new NotFoundAppException('Order not found');

    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: { acceptStatus: 'ACCEPTED' },
    });

    return { success: true, message: 'Order accepted', data: updated };
  }

  @Patch(':id/reject')
  async rejectOrder(@Req() req: any, @Param('id') id: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id, sellerId: req.sellerId },
    });
    if (!subOrder) throw new NotFoundAppException('Order not found');

    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: { acceptStatus: 'REJECTED' },
    });

    return { success: true, message: 'Order rejected', data: updated };
  }
}
