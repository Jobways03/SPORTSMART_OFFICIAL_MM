import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AffiliateSettingsService } from '../../application/services/affiliate-settings.service';
import { UpdateAffiliateSettingsDto } from '../dtos/affiliate-settings.dto';

/**
 * Read-only admin reporting endpoints — TDS records, top earners,
 * and platform settings (env-derived). Kept in a separate controller
 * from the CRUD endpoints so the admin reports surface stays small
 * and easy to audit.
 */
@ApiTags('Admin Affiliate Reports')
@Controller('admin/affiliates/reports')
@UseGuards(AdminAuthGuard)
export class AdminAffiliateReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: AffiliateSettingsService,
  ) {}

  @Get('tds')
  async listTdsRecords(
    @Query('financialYear') financialYear?: string,
    @Query('affiliateId') affiliateId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const where: any = {};
    if (financialYear) where.financialYear = financialYear;
    if (affiliateId) where.affiliateId = affiliateId;

    const [records, total] = await this.prisma.$transaction([
      this.prisma.affiliateTdsRecord.findMany({
        where,
        include: {
          affiliate: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: [{ financialYear: 'desc' }, { cumulativeGross: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.affiliateTdsRecord.count({ where }),
    ]);

    return {
      success: true,
      message: 'TDS records fetched',
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

  @Get('top-earners')
  async topEarners(@Query('limit') limit?: string) {
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '10', 10) || 10));
    // Group commissions by affiliate, sum the paid portion. CONFIRMED
    // is included so admins can spot affiliates with big balances who
    // haven't requested payout yet — not just historical leaders.
    const grouped = await this.prisma.affiliateCommission.groupBy({
      by: ['affiliateId'],
      where: { status: { in: ['PAID', 'CONFIRMED'] } },
      _sum: { adjustedAmount: true },
      _count: { _all: true },
    });
    const sorted = grouped
      .map((g) => ({
        affiliateId: g.affiliateId,
        totalEarned: (g._sum.adjustedAmount ?? 0).toString(),
        commissionCount: g._count._all,
      }))
      .sort((a, b) => Number(b.totalEarned) - Number(a.totalEarned))
      .slice(0, limitNum);

    if (sorted.length === 0) {
      return { success: true, message: 'No earners yet', data: { rows: [] } };
    }

    const affiliateIds = sorted.map((s) => s.affiliateId);
    const affiliates = await this.prisma.affiliate.findMany({
      where: { id: { in: affiliateIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
      },
    });
    const byId = new Map(affiliates.map((a) => [a.id, a]));

    return {
      success: true,
      message: 'Top earners fetched',
      data: {
        rows: sorted.map((s, i) => ({
          rank: i + 1,
          ...s,
          affiliate: byId.get(s.affiliateId) ?? null,
        })),
      },
    };
  }

  @Get('settings')
  async getPlatformSettings() {
    const data = await this.settingsService.get();
    return {
      success: true,
      message: 'Platform settings',
      data,
    };
  }

  @Patch('settings')
  @HttpCode(HttpStatus.OK)
  async updatePlatformSettings(
    @Req() req: Request,
    @Body() dto: UpdateAffiliateSettingsDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.settingsService.update({ adminId, patch: dto });
    return {
      success: true,
      message: 'Settings updated',
      data,
    };
  }
}
