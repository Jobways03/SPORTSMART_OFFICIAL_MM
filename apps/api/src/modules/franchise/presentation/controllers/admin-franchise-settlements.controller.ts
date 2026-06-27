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
import { BadRequestAppException } from '../../../../core/exceptions';
import {
  AdminAuthGuard,
  RolesGuard,
  PermissionsGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { CurrentAdmin } from '../../../../core/decorators/current-actor.decorator';
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
  // Delegated settlements (2026-06-27) — franchise settlements are DECOUPLED from
  // the seller `settlements.*` perms (those were delegated to the type-scoped
  // D2C/Retailer admins and removed from SUPER_ADMIN). Re-gated on
  // `franchise.finance` (which SUPER_ADMIN still holds) + @Roles('SUPER_ADMIN'),
  // so franchise settlements keep working, HQ-run. Per-franchise delegation to
  // FRANCHISE_ADMIN is a separate, later feature.
  @Roles('SUPER_ADMIN')
  @Permissions('franchise.finance')
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
  // Isolation fix (2026-06-16) — was `settlements.read`, the GENERIC marketplace
  // settlement perm that D2C_ADMIN / RETAILER_ADMIN / SELLER_ADMIN all hold, so
  // a seller-type admin could read the FRANCHISE settlement register. Gate on
  // the franchise-domain perm instead: SUPER_ADMIN + FRANCHISE_ADMIN + the
  // platform finance-ops role (SELLER_OPERATIONS, which also adjusts franchise
  // settlements) hold it; marketplace seller-type admins do not.
  @Permissions('franchise.finance.read')
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
  // Isolation fix (2026-06-16) — see listSettlements: franchise-domain perm so
  // a marketplace seller-type admin can't pull the franchise CSV register.
  @Permissions('franchise.finance.read')
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

  // Declared BEFORE the `:id` route so `/preview` isn't captured as an id.
  // Read-only dry-run: which franchises / how many ledger entries / total
  // payout a Create-cycle would settle for the period, plus an overlap
  // warning. Mirrors the seller settlements preview so the franchise admin
  // doesn't commit blind. Read perm only; no step-up (nothing is written).
  @Get('preview')
  @Permissions('franchise.finance.read')
  async previewCycle(
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    if (!periodStart || !periodEnd) {
      throw new BadRequestAppException('periodStart and periodEnd are required');
    }
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestAppException('periodStart and periodEnd must be valid dates');
    }
    if (start > end) {
      throw new BadRequestAppException('periodStart must be on or before periodEnd');
    }
    const data = await this.settlementService.previewSettlementCycle(start, end);
    return {
      success: true,
      message: 'Franchise settlement preview generated',
      data,
    };
  }

  @Get(':id')
  // Isolation fix (2026-06-16) — see listSettlements: franchise-domain perm.
  @Permissions('franchise.finance.read')
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
  // Delegated settlements (2026-06-27) — decoupled from seller settlements.*;
  // gated on franchise.finance (SUPER_ADMIN holds it) so franchise approve/fail
  // keep working HQ-run after the seller-settlement delegation.
  @Permissions('franchise.finance')
  // Phase 26 — terminal state pin before pay; 1-min window because pay
  // typically follows immediately and the admin should re-prove freshness.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async approveSettlement(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ) {
    const data = await this.settlementService.approveSettlement(id, {
      approvedByAdminId: adminId,
    });

    return {
      success: true,
      message: 'Franchise settlement approved successfully',
      data,
    };
  }

  @Patch(':id/fail')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  // Delegated settlements (2026-06-27) — decoupled from seller settlements.*;
  // gated on franchise.finance (SUPER_ADMIN holds it) so franchise approve/fail
  // keep working HQ-run after the seller-settlement delegation.
  @Permissions('franchise.finance')
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
  // Delegated settlements (2026-06-27) — decoupled from seller settlements.markPaid;
  // gated on franchise.finance (SUPER_ADMIN holds it) so franchise pay keeps
  // working HQ-run after the seller-settlement delegation.
  @Permissions('franchise.finance')
  // Phase 26 — terminal money-out; tight 1-min window.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  // Phase 159v (audit #16) — defense-in-depth against rapid double-submit of a
  // money-out. The authoritative double-pay guard is the compare-and-swap in
  // markSettlementPaid; this just blunts a burst before it reaches the service.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async markSettlementPaid(
    @Param('id') id: string,
    @Body() dto: FranchiseSettlementPayDto,
    @CurrentAdmin() adminId: string,
  ) {
    const data = await this.settlementService.markSettlementPaid(id, {
      paymentReference: dto.paymentReference,
      paymentMethod: dto.paymentMethod,
      paymentProofUrl: dto.paymentProofUrl,
      paidByAdminId: adminId,
    });

    return {
      success: true,
      message: 'Franchise settlement marked as paid',
      data,
    };
  }
}
