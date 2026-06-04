import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { AccessLogService } from '../../application/services/access-log.service';
import { CustomerAccessHistoryQueryDto } from '../dtos/customer-access-history-query.dto';

@ApiTags('Customer Account')
@Controller('customer/account/access-history')
@UseGuards(UserAuthGuard)
export class CustomerAccessHistoryController {
  constructor(private readonly service: AccessLogService) {}

  @Get()
  // Phase 201 (#4) — 30 reads/min/IP. This is a personal audit page a
  // human refreshes occasionally; a tight cap blunts scraping of the
  // (already-minimised) sign-in metadata.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(
    @Req() req: Request & { userId?: string },
    @Query() query: CustomerAccessHistoryQueryDto,
  ) {
    // Phase 201 (#1) — listForCustomer returns the hard-whitelisted
    // customer-safe projection (no deviceHash / reason / actorRole /
    // metadata). Never spread the raw row here.
    const items = await this.service.listForCustomer({
      actorId: req.userId!,
      limit: query.limit ?? 50,
    });
    return { success: true, message: 'Access history retrieved', data: { items } };
  }
}
