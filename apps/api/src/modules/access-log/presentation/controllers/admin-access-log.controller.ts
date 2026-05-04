import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AccessActorType, AccessEventKind } from '@prisma/client';
import { AdminAuthGuard } from '../../../../core/guards';
import { AccessLogService } from '../../application/services/access-log.service';

@ApiTags('Admin Access Logs')
@Controller('admin/access-logs')
@UseGuards(AdminAuthGuard)
export class AdminAccessLogController {
  constructor(private readonly service: AccessLogService) {}

  /**
   * Failed-login spike summary across all actors. Surfaces brute-force
   * attempts before a real breach. Defaults: 5+ failures in last 24h.
   * Mounted before the :actorType/:actorId route so the path doesn't
   * collide with the parameterised one.
   */
  @Get('spike/failed-logins')
  async failedLoginSpike(
    @Query('hours') hours?: string,
    @Query('minFailures') minFailures?: string,
  ) {
    const data = await this.service.failedLoginSpike({
      hours: hours ? parseInt(hours, 10) : 24,
      minFailures: minFailures ? parseInt(minFailures, 10) : 5,
    });
    return { success: true, message: 'Failed-login spike retrieved', data };
  }

  @Get(':actorType/:actorId')
  async listForActor(
    @Param('actorType') actorType: string,
    @Param('actorId') actorId: string,
    @Query('kind') kind?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.service.listForActor({
      actorType: actorType.toUpperCase() as AccessActorType,
      actorId,
      kind: kind ? (kind.toUpperCase() as AccessEventKind) : undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return { success: true, message: 'Access history retrieved', data: { items } };
  }
}
