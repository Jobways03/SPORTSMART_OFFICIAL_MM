import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AccessActorType, AccessEventKind } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { AccessLogService } from '../../application/services/access-log.service';

@ApiTags('Admin Access Logs')
@Controller('admin/access-logs')
@UseGuards(AdminAuthGuard, PermissionsGuard)
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

  /**
   * Phase 4 (PR 3.2) — raw LOGIN_FAILURE stream. Complements the spike
   * summary by listing individual failure events regardless of count.
   * Declared before :actorType so the literal `recent-failures`
   * segment doesn't get swallowed.
   */
  @Get('recent-failures')
  async recentFailures(
    @Query('actorType') actorType?: string,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.recentFailures({
      actorType: actorType
        ? (actorType.toUpperCase() as AccessActorType)
        : undefined,
      hours: hours ? parseInt(hours, 10) : 24,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return { success: true, message: 'Recent failed logins', data };
  }

  /**
   * Phase 4 (PR 3.1) — recent-actors quick-pick. Returns distinct
   * actors of the given type sorted by last-seen. Powers the
   * "Recent actors" panel on the Per-actor lookup tab.
   * Declared before :actorType so the literal `recent-actors`
   * segment doesn't get swallowed.
   */
  @Get('recent-actors')
  async recentActors(
    @Query('actorType') actorType?: string,
    @Query('actorRole') actorRole?: string,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.recentActors({
      actorType: (actorType?.toUpperCase() ?? 'ADMIN') as AccessActorType,
      actorRole: actorRole ? actorRole.toUpperCase() : undefined,
      hours: hours ? parseInt(hours, 10) : 24 * 7,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return { success: true, message: 'Recent actors', data };
  }

  /**
   * Phase 4 (PR 3) — list access events for a given admin sub-role
   * within the window. Declared before the parameterised :actorType
   * route so the literal `by-role` segment doesn't get swallowed.
   */
  @Get('by-role/:actorRole')
  async listByRole(
    @Param('actorRole') actorRole: string,
    @Query('actorType') actorType?: string,
    @Query('kind') kind?: string,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.listByRole({
      actorRole: actorRole.toUpperCase(),
      actorType: actorType
        ? (actorType.toUpperCase() as AccessActorType)
        : ('ADMIN' as AccessActorType),
      kind: kind ? (kind.toUpperCase() as AccessEventKind) : undefined,
      hours: hours ? parseInt(hours, 10) : 24,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return { success: true, message: 'Access logs by role retrieved', data };
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
