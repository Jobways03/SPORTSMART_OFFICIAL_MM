import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { FranchiseAuthGuard, FranchiseActiveGuard } from '../../../../core/guards';
import { FranchiseCommissionService } from '../../application/services/franchise-commission.service';

/**
 * Phase 181 (Franchise Ledger audit #9) — a franchise's self-view of its OWN
 * ledger + running balance. Every query is scoped to `req.franchiseId` (the
 * authenticated session); there is no franchiseId path/query param to tamper
 * with. Guard-only (the franchise-self convention), read-only — no adjustment /
 * penalty actions are exposed here.
 */
@ApiTags('Franchise Ledger (self)')
@Controller('franchise/me/ledger')
@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class FranchiseLedgerSelfController {
  constructor(private readonly commissionService: FranchiseCommissionService) {}

  private franchiseIdOf(req: Request): string {
    const id = (req as any).franchiseId;
    if (!id) throw new BadRequestException('Franchise session not found');
    return id;
  }

  @Get('balance')
  async myBalance(@Req() req: Request, @Query('asOf') asOf?: string) {
    const franchiseId = this.franchiseIdOf(req);
    let asOfDate: Date | undefined;
    if (asOf) {
      asOfDate = new Date(asOf);
      if (isNaN(asOfDate.getTime())) throw new BadRequestException('Invalid asOf date');
    }
    const data = await this.commissionService.getBalance(franchiseId, asOfDate);
    return { success: true, message: 'Your ledger balance', data };
  }

  @Get()
  async myLedger(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const franchiseId = this.franchiseIdOf(req);
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
      throw new BadRequestException('Invalid date');
    }
    const data = await this.commissionService.getLedgerHistory(franchiseId, {
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
      sourceType,
      status,
      fromDate: from,
      toDate: to,
    });
    return { success: true, message: 'Your ledger', data };
  }
}
