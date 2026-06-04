import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FranchiseAuthGuard, FranchiseActiveGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { AccountsDashboardService } from '../../application/services/accounts-dashboard.service';
import { AccountsDateRangeDto } from '../dtos/accounts-date-range.dto';
import { parseAccountsRange } from '../accounts-range.util';

/**
 * Phase 177 (Per-Franchise Accounts audit #4) — a franchise's self-view of its
 * OWN finances. Every query is scoped to `req.franchiseId` (the authenticated
 * session), so a franchise can NEVER reference another franchise's data: there
 * is no franchiseId path/query/body param to tamper with. Same service + bundle
 * shape as the admin per-franchise view. Guarded by FranchiseAuthGuard +
 * FranchiseActiveGuard (the codebase's franchise-portal convention, matching
 * the existing franchise-earnings controller).
 */
@ApiTags('Franchise Accounts')
@Controller('franchise/accounts')
@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class FranchiseAccountsController {
  constructor(private readonly dashboardService: AccountsDashboardService) {}

  private franchiseIdOf(req: any): string {
    const id = req?.franchiseId;
    if (!id) throw new BadRequestAppException('Franchise session not found');
    return id;
  }

  @Get('overview')
  async myOverview(@Req() req: any, @Query() query: AccountsDateRangeDto) {
    const franchiseId = this.franchiseIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getFranchiseAccountsOverview(franchiseId, from, to);
    return { success: true, message: 'Your accounts overview', data };
  }

  @Get('ledger')
  async myLedger(
    @Req() req: any,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const franchiseId = this.franchiseIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchiseLedgerEntries(franchiseId, from, to, pageNum, limitNum);
    return { success: true, message: 'Your ledger', data };
  }

  @Get('pos-sales')
  async myPos(
    @Req() req: any,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const franchiseId = this.franchiseIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchisePosSales(franchiseId, from, to, pageNum, limitNum);
    return { success: true, message: 'Your POS sales', data };
  }

  @Get('settlements')
  async mySettlements(
    @Req() req: any,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const franchiseId = this.franchiseIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getFranchiseSettlementsList(franchiseId, from, to, pageNum, limitNum);
    return { success: true, message: 'Your settlements', data };
  }
}
