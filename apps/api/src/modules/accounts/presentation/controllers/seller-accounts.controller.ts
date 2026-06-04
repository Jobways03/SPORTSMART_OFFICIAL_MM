import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SellerAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { AccountsDashboardService } from '../../application/services/accounts-dashboard.service';
import { AccountsDateRangeDto } from '../dtos/accounts-date-range.dto';
import { parseAccountsRange } from '../accounts-range.util';

/**
 * Phase 176 (Per-Seller Accounts audit #4) — a seller's self-view of their OWN
 * finances. Every query is scoped to `req.sellerId` (the authenticated session),
 * so a seller can NEVER reference another seller's data: there is no sellerId
 * path/query/body param to tamper with. Same service + bundle shape as the admin
 * per-seller view. Guarded by SellerAuthGuard (the codebase's seller-endpoint
 * convention — auth-by-session, scope-by-req.sellerId; no permission slug).
 */
@ApiTags('Seller Accounts')
@Controller('seller/accounts')
@UseGuards(SellerAuthGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class SellerAccountsController {
  constructor(private readonly dashboardService: AccountsDashboardService) {}

  private sellerIdOf(req: any): string {
    const id = req?.sellerId;
    if (!id) throw new BadRequestAppException('Seller session not found');
    return id;
  }

  @Get('overview')
  async myOverview(@Req() req: any, @Query() query: AccountsDateRangeDto) {
    const sellerId = this.sellerIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const data = await this.dashboardService.getSellerAccountsOverview(sellerId, from, to);
    return { success: true, message: 'Your accounts overview', data };
  }

  @Get('commission-records')
  async myCommission(
    @Req() req: any,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const sellerId = this.sellerIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getSellerCommissionRecords(sellerId, from, to, pageNum, limitNum);
    return { success: true, message: 'Your commission records', data };
  }

  @Get('settlements')
  async mySettlements(
    @Req() req: any,
    @Query() query: AccountsDateRangeDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const sellerId = this.sellerIdOf(req);
    const { from, to } = parseAccountsRange(query);
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.dashboardService.getSellerSettlements(sellerId, from, to, pageNum, limitNum);
    return { success: true, message: 'Your settlements', data };
  }
}
