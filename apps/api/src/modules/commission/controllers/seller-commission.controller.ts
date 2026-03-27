import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { SellerAuthGuard } from '../../seller/infrastructure/guards/seller-auth.guard';

@ApiTags('Seller Commission')
@Controller('seller/commission')
@UseGuards(SellerAuthGuard)
export class SellerCommissionController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listCommissions(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { sellerId: req.sellerId };

    if (status && ['PENDING', 'SETTLED', 'REFUNDED'].includes(status)) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { productTitle: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return {
      success: true,
      message: 'Commission records retrieved',
      data: {
        records,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }
}
