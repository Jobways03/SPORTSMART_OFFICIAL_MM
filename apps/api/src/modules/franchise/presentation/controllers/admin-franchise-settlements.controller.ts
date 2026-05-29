import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';
import {
  AdminAuthGuard,
  RolesGuard,
  PermissionsGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FranchiseSettlementService } from '../../application/services/franchise-settlement.service';
import { FranchiseSettlementCreateDto } from '../dtos/franchise-settlement-create.dto';
import { FranchiseSettlementPayDto } from '../dtos/franchise-settlement-pay.dto';
import { FranchiseSettlementFailDto } from '../dtos/franchise-settlement-fail.dto';

@ApiTags('Admin Franchise Settlements')
@Controller('admin/franchise-settlements')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, StepUpGuard)
export class AdminFranchiseSettlementsController {
  constructor(
    private readonly settlementService: FranchiseSettlementService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('settlements.approve')
  // Phase 26 — opens a new settlement cycle; mutates the ledger
  // grouping for the period.
  @RequiresStepUp()
  async createSettlementCycle(@Body() dto: FranchiseSettlementCreateDto) {
    const data = await this.settlementService.createSettlementCycle(
      new Date(dto.periodStart),
      new Date(dto.periodEnd),
    );

    return {
      success: true,
      message: 'Franchise settlement cycle created successfully',
      data,
    };
  }

  @Get()
  @Permissions('settlements.read')
  async listSettlements(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cycleId') cycleId?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const { settlements, total } = await this.settlementService.listSettlements({
      page: pageNum,
      limit: limitNum,
      cycleId,
      franchiseId,
      status,
    });

    // Wrap in the pagination envelope used by every other list
    // endpoint in this codebase — admin-products, admin-categories,
    // storefront-products, admin-procurement (fixed in this pass),
    // franchise-procurement (fixed in this pass). The franchise-admin
    // dashboard reads `data.pagination.total` for its "Pending
    // Settlements" KPI; without this wrapper the tile stays at "--".
    return {
      success: true,
      message: 'Franchise settlements fetched successfully',
      data: {
        settlements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // Phase 159v (audit #11) — declared BEFORE the `:id` route so `/export`
  // isn't captured as an id. Finance/Tally CSV of the settlement register.
  @Get('export')
  @Permissions('settlements.read')
  async exportSettlements(
    @Res() res: Response,
    @Query('cycleId') cycleId?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('status') status?: string,
  ) {
    const { rows, total, truncated } =
      await this.settlementService.exportSettlements({
        cycleId,
        franchiseId,
        status,
      });

    const headers = [
      'settlementId',
      'cycleId',
      'cyclePeriodStart',
      'cyclePeriodEnd',
      'franchiseCode',
      'franchiseName',
      'status',
      'totalOnlineOrders',
      'totalOnlineAmount',
      'totalOnlineCommission',
      'totalProcurements',
      'totalProcurementAmount',
      'totalProcurementFees',
      'totalPosSales',
      'totalPosAmount',
      'totalPosFees',
      'reversalAmount',
      'adjustmentAmount',
      'grossFranchiseEarning',
      'totalPlatformEarning',
      'netPayableToFranchise',
      'paidAt',
      'paymentReference',
      'createdAt',
    ];

    const mapped = rows.map((r: any) => ({
      settlementId: r.id,
      cycleId: r.cycleId,
      cyclePeriodStart: r.cycle?.periodStart ?? null,
      cyclePeriodEnd: r.cycle?.periodEnd ?? null,
      franchiseCode: r.franchise?.franchiseCode ?? '',
      franchiseName: r.franchiseName ?? r.franchise?.businessName ?? '',
      status: r.status,
      totalOnlineOrders: r.totalOnlineOrders,
      totalOnlineAmount: Number(r.totalOnlineAmount),
      totalOnlineCommission: Number(r.totalOnlineCommission),
      totalProcurements: r.totalProcurements,
      totalProcurementAmount: Number(r.totalProcurementAmount),
      totalProcurementFees: Number(r.totalProcurementFees),
      totalPosSales: r.totalPosSales,
      totalPosAmount: Number(r.totalPosAmount),
      totalPosFees: Number(r.totalPosFees),
      reversalAmount: Number(r.reversalAmount),
      adjustmentAmount: Number(r.adjustmentAmount),
      grossFranchiseEarning: Number(r.grossFranchiseEarning),
      totalPlatformEarning: Number(r.totalPlatformEarning),
      netPayableToFranchise: Number(r.netPayableToFranchise),
      paidAt: r.paidAt ?? null,
      paymentReference: r.paymentReference ?? '',
      createdAt: r.createdAt,
    }));

    const csv = toCsv(mapped, headers, { bom: true });
    const filename = `${csvFilenameSlug([
      'franchise_settlements',
      cycleId,
      franchiseId,
      status,
    ]) || 'franchise_settlements_export'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Total', String(total));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  @Get(':id')
  @Permissions('settlements.read')
  async getSettlementDetail(@Param('id') id: string) {
    const data = await this.settlementService.getSettlementDetail(id);

    return {
      success: true,
      message: 'Franchise settlement detail fetched successfully',
      data,
    };
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.approve')
  // Phase 26 — terminal state pin before pay; 1-min window because pay
  // typically follows immediately and the admin should re-prove freshness.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async approveSettlement(@Param('id') id: string) {
    const data = await this.settlementService.approveSettlement(id);

    return {
      success: true,
      message: 'Franchise settlement approved successfully',
      data,
    };
  }

  @Patch(':id/fail')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.approve')
  @RequiresStepUp()
  async markSettlementFailed(
    @Param('id') id: string,
    @Body() dto: FranchiseSettlementFailDto,
  ) {
    const data = await this.settlementService.markSettlementFailed(
      id,
      dto.reason,
    );

    return {
      success: true,
      message: 'Franchise settlement marked as failed',
      data,
    };
  }

  @Patch(':id/pay')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.markPaid')
  // Phase 26 — terminal money-out; tight 1-min window.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  // Phase 159v (audit #16) — defense-in-depth against rapid double-submit of a
  // money-out. The authoritative double-pay guard is the compare-and-swap in
  // markSettlementPaid; this just blunts a burst before it reaches the service.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async markSettlementPaid(
    @Param('id') id: string,
    @Body() dto: FranchiseSettlementPayDto,
  ) {
    const data = await this.settlementService.markSettlementPaid(
      id,
      dto.paymentReference,
    );

    return {
      success: true,
      message: 'Franchise settlement marked as paid',
      data,
    };
  }
}
