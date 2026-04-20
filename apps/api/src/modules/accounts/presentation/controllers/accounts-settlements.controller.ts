import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { AccountsSettlementService } from '../../application/services/accounts-settlement.service';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';

@ApiTags('Admin Accounts - Settlements')
@Controller('admin/accounts/settlements')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AccountsSettlementsController {
  constructor(
    private readonly settlementService: AccountsSettlementService,
  ) {}

  /* ── GET /admin/accounts/settlements/payables ── */
  @Get('payables')
  async getPayables(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('nodeType') nodeType?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(
      50,
      Math.max(1, parseInt(limit || '20', 10) || 20),
    );

    const validNodeTypes = ['SELLER', 'FRANCHISE', 'ALL'];
    const parsedNodeType =
      nodeType && validNodeTypes.includes(nodeType.toUpperCase())
        ? (nodeType.toUpperCase() as 'SELLER' | 'FRANCHISE' | 'ALL')
        : 'ALL';

    const validStatuses = ['PENDING', 'APPROVED', 'PAID'];
    const parsedStatus =
      status && validStatuses.includes(status.toUpperCase())
        ? (status.toUpperCase() as 'PENDING' | 'APPROVED' | 'PAID')
        : undefined;

    const data = await this.settlementService.getPayablesSummary(
      pageNum,
      limitNum,
      parsedNodeType,
      parsedStatus,
      search,
    );

    return {
      success: true,
      message: 'Unified payables retrieved',
      data: {
        ...data,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: data.total,
          totalPages: Math.ceil(data.total / limitNum),
        },
      },
    };
  }

  /* ── GET /admin/accounts/settlements/cycles ── */
  @Get('cycles')
  async listCycles(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(
      50,
      Math.max(1, parseInt(limit || '20', 10) || 20),
    );

    const data = await this.settlementService.listSettlementCycles(
      pageNum,
      limitNum,
      status,
    );

    return {
      success: true,
      message: 'Settlement cycles retrieved',
      data: {
        ...data,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: data.total,
          totalPages: Math.ceil(data.total / limitNum),
        },
      },
    };
  }

  /* ── GET /admin/accounts/settlements/cycles/:cycleId ── */
  @Get('cycles/:cycleId')
  async getCycleDetail(@Param('cycleId') cycleId: string) {
    const data =
      await this.settlementService.getSettlementCycleDetail(cycleId);

    if (!data) {
      throw new NotFoundException('Settlement cycle not found');
    }

    return {
      success: true,
      message: 'Settlement cycle detail retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/settlements/franchise-ledger/:entryId/history ── */
  @Get('franchise-ledger/:entryId/history')
  async getFranchiseLedgerHistory(@Param('entryId') entryId: string) {
    const data =
      await this.settlementService.getFranchiseLedgerHistory(entryId);
    return {
      success: true,
      message: 'Franchise ledger entry history retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/settlements/franchise-ledger/export ── */
  @Get('franchise-ledger/export')
  async exportFranchiseLedger(
    @Res() res: Response,
    @Query('franchiseId') franchiseId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const { rows, total, truncated } =
      await this.settlementService.exportFranchiseLedger({
        franchiseId,
        sourceType,
        status,
        fromDate,
        toDate,
      });

    const headers = [
      'createdAt',
      'franchiseCode',
      'franchiseName',
      'sourceType',
      'sourceId',
      'description',
      'baseAmount',
      'rate',
      'computedAmount',
      'platformEarning',
      'franchiseEarning',
      'status',
      'settlementBatchId',
      'settlementPaidAt',
      'paymentReference',
    ];

    const mapped = rows.map((r: any) => ({
      createdAt: r.createdAt,
      franchiseCode: r.franchise?.franchiseCode ?? '',
      franchiseName: r.franchise?.businessName ?? '',
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      description: r.description ?? '',
      baseAmount: Number(r.baseAmount),
      rate: Number(r.rate),
      computedAmount: Number(r.computedAmount),
      platformEarning: Number(r.platformEarning),
      franchiseEarning: Number(r.franchiseEarning),
      status: r.status,
      settlementBatchId: r.settlementBatch?.id ?? null,
      settlementPaidAt: r.settlementBatch?.paidAt ?? null,
      paymentReference: r.settlementBatch?.paymentReference ?? null,
    }));

    const csv = toCsv(mapped, headers);
    const filename = `${csvFilenameSlug([
      'franchise_ledger',
      fromDate,
      toDate,
      sourceType,
      status,
    ]) || 'franchise_ledger_export'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('X-Export-Total', String(total));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  /* ── GET /admin/accounts/settlements/cycles/:cycleId/export ── */
  @Get('cycles/:cycleId/export')
  async exportCycleBreakdown(
    @Res() res: Response,
    @Param('cycleId') cycleId: string,
  ) {
    const { cycle, sellerSettlements, franchiseSettlements } =
      await this.settlementService.exportCycleBreakdown(cycleId);

    const headers = [
      'cycleId',
      'cyclePeriodStart',
      'cyclePeriodEnd',
      'cycleStatus',
      'partnerType',
      'partnerId',
      'partnerName',
      'settlementId',
      'status',
      'totalOrders',
      'totalItems',
      'grossAmount',
      'netPayable',
      'platformEarning',
      'paidAt',
      'reference',
    ];

    const rows = [
      ...sellerSettlements.map((s) => ({
        cycleId: cycle.id,
        cyclePeriodStart: cycle.periodStart,
        cyclePeriodEnd: cycle.periodEnd,
        cycleStatus: cycle.status,
        partnerType: 'SELLER',
        partnerId: s.sellerId,
        partnerName: s.sellerName,
        settlementId: s.id,
        status: s.status,
        totalOrders: s.totalOrders,
        totalItems: s.totalItems,
        grossAmount: Number(s.totalPlatformAmount),
        netPayable: Number(s.totalSettlementAmount),
        platformEarning: Number(s.totalPlatformMargin),
        paidAt: s.paidAt,
        reference: s.utrReference,
      })),
      ...franchiseSettlements.map((f: any) => ({
        cycleId: cycle.id,
        cyclePeriodStart: cycle.periodStart,
        cyclePeriodEnd: cycle.periodEnd,
        cycleStatus: cycle.status,
        partnerType: 'FRANCHISE',
        partnerId: f.franchiseId,
        partnerName: f.franchiseName,
        settlementId: f.id,
        status: f.status,
        totalOrders: f.totalOnlineOrders,
        totalItems: 0,
        grossAmount: Number(f.grossFranchiseEarning),
        netPayable: Number(f.netPayableToFranchise),
        platformEarning: Number(f.totalPlatformEarning),
        paidAt: f.paidAt,
        reference: f.paymentReference,
      })),
    ];

    const csv = toCsv(rows, headers);
    const filename = `cycle_${csvFilenameSlug([
      cycleId,
    ])}_breakdown.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(csv);
  }

  /* ── GET /admin/accounts/settlements/preview ── */
  @Get('preview')
  async previewCycle(
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    if (!periodStart || !periodEnd) {
      throw new BadRequestException(
        'periodStart and periodEnd query params are required',
      );
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const data = await this.settlementService.previewSettlementCycle(
      start,
      end,
    );

    return {
      success: true,
      message: 'Settlement cycle preview',
      data,
    };
  }

  // Mutations on settlement state move real money (payout batch) or
  // pin the ledger's grouping (new cycle / cycle preview). Restrict to
  // SUPER_ADMIN, matching /admin/settlements/mark-paid and the other
  // money-movement endpoints locked down in earlier areas.

  /* ── POST /admin/accounts/settlements/mark-paid ── */
  @Post('mark-paid')
  @Roles('SUPER_ADMIN')
  async batchMarkPaid(
    @Req() req: Request,
    @Body()
    body: {
      settlements: Array<{
        id: string;
        type: 'seller' | 'franchise';
        reference: string;
      }>;
    },
  ) {
    if (!body?.settlements || !Array.isArray(body.settlements)) {
      throw new BadRequestException('settlements array is required');
    }
    const adminId = (req as any).adminId;
    const data = await this.settlementService.batchMarkPaid(
      body.settlements,
      { adminId },
    );
    return {
      success: true,
      message: 'Batch mark-paid processed',
      data,
    };
  }

  /* ── PATCH /admin/accounts/settlements/cycles/:cycleId/preview ── */
  @Patch('cycles/:cycleId/preview')
  @Roles('SUPER_ADMIN')
  async markCyclePreviewed(@Param('cycleId') cycleId: string) {
    const cycle = await this.settlementService.markCyclePreviewed(cycleId);
    return {
      success: true,
      message: 'Settlement cycle moved to PREVIEWED',
      data: cycle,
    };
  }

  /* ── POST /admin/accounts/settlements/cycles ── */
  @Post('cycles')
  @Roles('SUPER_ADMIN')
  async createCycle(
    @Body() body: { periodStart: string; periodEnd: string },
  ) {
    if (!body.periodStart || !body.periodEnd) {
      throw new BadRequestException(
        'periodStart and periodEnd are required',
      );
    }

    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);

    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (periodStart >= periodEnd) {
      throw new BadRequestException(
        'periodStart must be before periodEnd',
      );
    }

    const result =
      await this.settlementService.createUnifiedSettlementCycle(
        periodStart,
        periodEnd,
      );

    return {
      success: true,
      message: result.message,
      data: {
        cycle: result.cycle,
        sellerSettlementCount: result.sellerSettlementCount,
        franchiseSettlementCount: result.franchiseSettlementCount,
      },
    };
  }
}
