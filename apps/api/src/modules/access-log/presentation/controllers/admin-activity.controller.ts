import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AccessActorType } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminActivityService,
  ActivitySource,
} from '../../application/services/admin-activity.service';
import { AdminActivityQueryDto } from '../dtos/admin-activity-query.dto';

/**
 * PR 4 — Admin Activity timeline. Read-only merge of access_logs +
 * admin_action_audit_logs + audit_logs (business) + admin_impersonation_logs
 * filtered by role / id / window.
 *
 * Phase 208 (#3) — the gate was 'roles.read' (shared with the RBAC
 * dashboard), so anyone who could view roles could read the cross-actor
 * activity feed. Split into the dedicated 'admin.activity.read'
 * permission, assigned only to the security / risk / compliance tiers.
 *
 * Phase 208 (#5) — every view writes an ADMIN_ACTIVITY_VIEWED audit row.
 * The activity timeline is a surveillance surface (who-did-what across all
 * admins); reads of it must themselves be auditable.
 *
 * Phase 208 (#6) — class-level @Throttle (30/min/IP).
 * Phase 208 (#7) — class-validator DTO so bad params 400 at the edge.
 */
@ApiTags('Admin Activity')
@Controller('admin/activity')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminActivityController {
  constructor(
    private readonly service: AdminActivityService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get()
  @Permissions('admin.activity.read')
  async timeline(
    @Query() query: AdminActivityQueryDto,
    @Req() req: Request & { adminId?: string; adminRole?: string },
  ) {
    const data = await this.service.timeline({
      actorRole: query.actorRole ? query.actorRole.toUpperCase() : undefined,
      actorId: query.actorId,
      actorType: query.actorType
        ? (query.actorType as AccessActorType)
        : undefined,
      hours: query.hours ?? 24,
      limit: query.limit ?? 200,
      source: query.source as ActivitySource | undefined,
    });

    // Phase 208 (#5) — audit the read. Best-effort: an audit-write failure
    // must not block the operator's view. Records the scope of what was
    // looked at (role/id/window) so an investigator can see who reviewed
    // whose activity.
    this.audit
      .writeAuditLog({
        actorId: req?.adminId,
        actorRole: req?.adminRole,
        action: 'ADMIN_ACTIVITY_VIEWED',
        module: 'access-log',
        resource: 'admin-activity',
        metadata: {
          filterActorRole: query.actorRole ?? null,
          filterActorId: query.actorId ?? null,
          filterActorType: query.actorType ?? null,
          hours: query.hours ?? 24,
          source: query.source ?? null,
          resultCount: data.items.length,
          truncated: data.truncated,
        },
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent'] as string | undefined,
      })
      .catch(() => undefined);

    return { success: true, message: 'Admin activity timeline', data };
  }
}
