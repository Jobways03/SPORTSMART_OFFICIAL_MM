import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AccessActorType } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AdminActivityService } from '../../application/services/admin-activity.service';

/**
 * PR 4 — Admin Activity timeline. Read-only join of access_logs +
 * admin_action_audit_logs filtered by role / id / window. Gated by the
 * same `roles.read` permission used by the authz-readiness page so any
 * admin who can already see the RBAC dashboard can see this.
 */
@ApiTags('Admin Activity')
@Controller('admin/activity')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminActivityController {
  constructor(private readonly service: AdminActivityService) {}

  @Get()
  @Permissions('roles.read')
  async timeline(
    @Query('actorRole') actorRole?: string,
    @Query('actorId') actorId?: string,
    @Query('actorType') actorType?: string,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ) {
    const normalizedSource =
      source?.toUpperCase() === 'AUTH'
        ? 'AUTH'
        : source?.toUpperCase() === 'BUSINESS'
          ? 'BUSINESS'
          : undefined;
    const data = await this.service.timeline({
      actorRole: actorRole ? actorRole.toUpperCase() : undefined,
      actorId,
      actorType: actorType
        ? (actorType.toUpperCase() as AccessActorType)
        : undefined,
      hours: hours ? parseInt(hours, 10) : 24,
      limit: limit ? parseInt(limit, 10) : 200,
      source: normalizedSource,
    });
    return { success: true, message: 'Admin activity timeline', data };
  }
}
