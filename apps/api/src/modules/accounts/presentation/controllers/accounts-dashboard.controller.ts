import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { AccountsDashboardService } from '../../application/services/accounts-dashboard.service';

@ApiTags('Admin Accounts - Dashboard')
@Controller('admin/accounts/dashboard')
@UseGuards(AdminAuthGuard)
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
