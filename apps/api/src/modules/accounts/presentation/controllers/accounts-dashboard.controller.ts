import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AccountsDashboardService } from '../../application/services/accounts-dashboard.service';

/**
 * Phase 24 (2026-05-20) — class-level @Permissions('settlements.read')
 * because every method is a finance read. Pre-Phase-24 no @Permissions
 * decorator existed, so PermissionsGuard let every logged-in admin
 * read platform / seller / franchise financial overviews. The default
 * grant for SELLER_OPERATIONS + AFFILIATE_ADMIN already includes
 * settlements.read.
 */
@ApiTags('Admin Accounts - Dashboard')
@Controller('admin/accounts/dashboard')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('settlements.read')
export class AccountsDashboardController {
  constructor(
    private readonly dashboardService: AccountsDashboardService,
  ) {}

  /* ── GET /admin/accounts/dashboard/overview ── */
  @Get('overview')
  async getOverview(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const data = await this.dashboardService.getPlatformOverview(from, to);

    return {
      success: true,
      message: 'Platform finance overview retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/dashboard/sellers ── */
  @Get('sellers')
  async getSellerOverview(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const data = await this.dashboardService.getSellerOverview(from, to);

    return {
      success: true,
      message: 'Seller financial overview retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/dashboard/franchises ── */
  @Get('franchises')
  async getFranchiseOverview(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const data = await this.dashboardService.getFranchiseOverview(
      from,
      to,
    );

    return {
      success: true,
      message: 'Franchise financial overview retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/dashboard/outstanding ── */
  @Get('outstanding')
  async getOutstanding() {
    const data = await this.dashboardService.getOutstandingPayables();

    return {
      success: true,
      message: 'Outstanding payables retrieved',
      data,
    };
  }

  /* ── GET /admin/accounts/dashboard/top-performers ── */
  @Get('top-performers')
  async getTopPerformers(
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const limitNum = Math.min(
      50,
      Math.max(1, parseInt(limit || '10', 10) || 10),
    );
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const data = await this.dashboardService.getTopPerformers(
      limitNum,
      from,
      to,
    );

    return {
      success: true,
      message: 'Top performers retrieved',
      data,
    };
  }
}
