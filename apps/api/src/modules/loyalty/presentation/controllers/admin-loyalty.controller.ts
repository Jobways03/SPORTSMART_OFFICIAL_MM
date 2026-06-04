import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { LoyaltyService } from '../../application/services/loyalty.service';

/**
 * Phase 182 (#3) — admin visibility into the loyalty earn ledger (what was
 * awarded / skipped per order). Gated by wallets.read (wallet-adjacent finance).
 */
@ApiTags('Admin Loyalty')
@Controller('admin/loyalty')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('wallets.read')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('events')
  async listEvents(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.loyalty.listEvents({
      status: status || undefined,
      userId: userId || undefined,
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
    });
    return { success: true, message: 'Loyalty earn events', data, config: { enabled: this.loyalty.enabled() } };
  }
}
