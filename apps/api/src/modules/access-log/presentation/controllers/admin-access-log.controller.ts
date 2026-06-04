import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AccessActorType, AccessEventKind } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AccessLogService } from '../../application/services/access-log.service';
import {
  FailedLoginSpikeQueryDto,
  ListByRoleQueryDto,
  ListForActorQueryDto,
  RecentActorsQueryDto,
  RecentFailuresQueryDto,
} from '../dtos/admin-access-log-query.dto';

/**
 * Phase 24 (2026-05-20) — Every read annotated with @Permissions.
 * Pre-Phase-24 the controller wired PermissionsGuard but declared no
 * @Permissions, so every route passed the guard with
 * `requiredPermissions.length === 0` — any logged-in admin could read
 * brute-force spike data + cross-actor login history.
 *
 * Phase 207 (#1) — the gate was 'audit.read', shared with the
 * (much-more-widely-granted) audit-log reader. The brute-force surface
 * is an attack-telemetry / enumeration oracle (which emails/IPs are
 * being targeted, which accounts are locked), so it now requires the
 * dedicated 'security.read' permission, assigned only to the security /
 * risk / compliance tiers (see permission-registry + seed-admin-rbac).
 *
 * Phase 207 (#7) — class-level @Throttle (30/min/IP). These are
 * forensic read endpoints a human refreshes; the cap blunts scripted
 * scraping of the spike/enumeration data without hampering ops.
 *
 * Phase 207 (#8/#18) — every endpoint now binds a class-validator DTO,
 * so a bad `?hours=abc` 400s at the edge instead of reaching Prisma as
 * NaN / an invalid enum cast.
 */
@ApiTags('Admin Access Logs')
@Controller('admin/access-logs')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminAccessLogController {
  constructor(private readonly service: AccessLogService) {}

  /**
   * Failed-login spike summary across all actors. Surfaces brute-force
   * attempts before a real breach. Defaults: 5+ failures in last 24h.
   * Mounted before the :actorType/:actorId route so the path doesn't
   * collide with the parameterised one.
   */
  @Get('spike/failed-logins')
  @Permissions('security.read')
  async failedLoginSpike(@Query() query: FailedLoginSpikeQueryDto) {
    const data = await this.service.failedLoginSpike({
      hours: query.hours ?? 24,
      minFailures: query.minFailures ?? 5,
    });
    return { success: true, message: 'Failed-login spike retrieved', data };
  }

  /**
   * Phase 207 (#6) — distributed-attack views. ip-spike groups failures
   * by source IP across many accounts (credential stuffing / spray from
   * one host); account-spike groups failures for one account across many
   * IPs (a botnet hammering a single victim — invisible to the per-(actor,
   * IP) lockout backstop). Both complement the (actor, IP) spike above.
   */
  @Get('spike/by-ip')
  @Permissions('security.read')
  async ipSpike(@Query() query: FailedLoginSpikeQueryDto) {
    const data = await this.service.failedLoginSpikeByIp({
      hours: query.hours ?? 24,
      minFailures: query.minFailures ?? 20,
    });
    return { success: true, message: 'IP-level failed-login spike retrieved', data };
  }

  @Get('spike/by-account')
  @Permissions('security.read')
  async accountSpike(@Query() query: FailedLoginSpikeQueryDto) {
    const data = await this.service.failedLoginSpikeByAccount({
      hours: query.hours ?? 24,
      minFailures: query.minFailures ?? 10,
    });
    return { success: true, message: 'Account-level failed-login spike retrieved', data };
  }

  /**
   * Phase 4 (PR 3.2) — raw LOGIN_FAILURE stream. Complements the spike
   * summary by listing individual failure events regardless of count.
   * Declared before :actorType so the literal `recent-failures`
   * segment doesn't get swallowed.
   */
  @Get('recent-failures')
  @Permissions('security.read')
  async recentFailures(@Query() query: RecentFailuresQueryDto) {
    const data = await this.service.recentFailures({
      actorType: query.actorType
        ? (query.actorType as AccessActorType)
        : undefined,
      hours: query.hours ?? 24,
      limit: query.limit ?? 50,
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
  @Permissions('security.read')
  async recentActors(@Query() query: RecentActorsQueryDto) {
    const data = await this.service.recentActors({
      actorType: (query.actorType ?? 'ADMIN') as AccessActorType,
      actorRole: query.actorRole ? query.actorRole.toUpperCase() : undefined,
      hours: query.hours ?? 24 * 7,
      limit: query.limit ?? 20,
    });
    return { success: true, message: 'Recent actors', data };
  }

  /**
   * Phase 4 (PR 3) — list access events for a given admin sub-role
   * within the window. Declared before the parameterised :actorType
   * route so the literal `by-role` segment doesn't get swallowed.
   */
  @Get('by-role/:actorRole')
  @Permissions('security.read')
  async listByRole(
    @Param('actorRole') actorRole: string,
    @Query() query: ListByRoleQueryDto,
  ) {
    const data = await this.service.listByRole({
      actorRole: actorRole.toUpperCase(),
      actorType: (query.actorType
        ? (query.actorType as AccessActorType)
        : 'ADMIN') as AccessActorType,
      kind: query.kind ? (query.kind as AccessEventKind) : undefined,
      hours: query.hours ?? 24,
      limit: query.limit ?? 100,
    });
    return { success: true, message: 'Access logs by role retrieved', data };
  }

  @Get(':actorType/:actorId')
  @Permissions('security.read')
  async listForActor(
    @Param('actorType') actorType: string,
    @Param('actorId') actorId: string,
    @Query() query: ListForActorQueryDto,
  ) {
    const items = await this.service.listForActor({
      actorType: actorType.toUpperCase() as AccessActorType,
      actorId,
      kind: query.kind ? (query.kind as AccessEventKind) : undefined,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      limit: query.limit ?? 100,
    });
    return { success: true, message: 'Access history retrieved', data: { items } };
  }
}
