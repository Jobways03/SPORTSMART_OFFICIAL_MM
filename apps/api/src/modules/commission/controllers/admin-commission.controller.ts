import {
  Controller,
  Get,
  Put,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { AdminAuthGuard } from '../../admin/infrastructure/guards/admin-auth.guard';

@ApiTags('Admin Commission')
@Controller('admin/commission')
@UseGuards(AdminAuthGuard)
export class AdminCommissionController {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Global Commission Settings ── */

  @Get('settings')
  async getSettings() {
    let settings = await this.prisma.commissionSetting.findUnique({
      where: { id: 'global' },
    });

    if (!settings) {
      settings = await this.prisma.commissionSetting.create({
        data: { id: 'global' },
      });
    }

    return { success: true, message: 'Commission settings retrieved', data: settings };
  }

  @Put('settings')
  async updateSettings(
    @Body()
    body: {
      commissionType: string;
      commissionValue: number;
      secondCommissionValue?: number;
      fixedCommissionType?: string;
      enableMaxCommission?: boolean;
      maxCommissionAmount?: number;
    },
  ) {
    const settings = await this.prisma.commissionSetting.upsert({
      where: { id: 'global' },
      update: {
        commissionType: body.commissionType as any,
        commissionValue: body.commissionValue,
        secondCommissionValue: body.secondCommissionValue ?? 0,
        fixedCommissionType: body.fixedCommissionType ?? 'Product',
        enableMaxCommission: body.enableMaxCommission ?? false,
        maxCommissionAmount: body.maxCommissionAmount ?? null,
      },
      create: {
        id: 'global',
        commissionType: body.commissionType as any,
        commissionValue: body.commissionValue,
        secondCommissionValue: body.secondCommissionValue ?? 0,
        fixedCommissionType: body.fixedCommissionType ?? 'Product',
        enableMaxCommission: body.enableMaxCommission ?? false,
        maxCommissionAmount: body.maxCommissionAmount ?? null,
      },
    });

    return { success: true, message: 'Commission settings updated', data: settings };
  }

  /* ── Commission Records List ── */

  @Get()
  async listCommissions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sellerId') sellerId?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('commissionType') commissionType?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (sellerId) {
      where.sellerId = sellerId;
    }

    if (commissionType) {
      where.commissionType = commissionType;
    }

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
        { sellerName: { contains: search, mode: 'insensitive' } },
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

  /* ── Summary (aggregate margin data) ── */

  @Get('summary')
  async getSummary() {
    const [totalRecords, platformAgg, settlementAgg, marginAgg, pendingAgg, settledAgg] =
      await Promise.all([
        this.prisma.commissionRecord.count(),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalPlatformAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { platformMargin: true },
        }),
        this.prisma.commissionRecord.count({ where: { status: 'PENDING' } }),
        this.prisma.commissionRecord.count({ where: { status: 'SETTLED' } }),
      ]);

    return {
      success: true,
      message: 'Commission summary retrieved',
      data: {
        totalRecords,
        pendingCount: pendingAgg,
        settledCount: settledAgg,
        totalPlatformRevenue: Number(platformAgg._sum.totalPlatformAmount || 0),
        totalSellerPayouts: Number(settlementAgg._sum.totalSettlementAmount || 0),
        totalPlatformMargin: Number(marginAgg._sum.platformMargin || 0),
      },
    };
  }
}
