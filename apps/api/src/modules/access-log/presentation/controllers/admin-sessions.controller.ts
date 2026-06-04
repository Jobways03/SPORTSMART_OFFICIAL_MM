import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminSessionsService,
  ActorType,
} from '../../application/services/admin-sessions.service';
import {
  RevokeAllSessionsDto,
  RevokeSessionDto,
  SessionsListQueryDto,
} from '../dtos/admin-sessions.dto';

// Phase 27 (2026-05-21) — AFFILIATE added. The affiliate session
// table is fully populated (login + refresh + theft detection) and
// AffiliateAuthGuard validates revokedAt (Phase 22) — but pre-Phase-27
// the admin surface had no way to list or revoke affiliate sessions.
const ACTOR_TYPES: readonly ActorType[] = [
  'ADMIN',
  'USER',
  'SELLER',
  'FRANCHISE',
  'AFFILIATE',
];

function parseActorType(raw: string | undefined): ActorType | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if ((ACTOR_TYPES as readonly string[]).includes(upper)) return upper as ActorType;
  throw new BadRequestException(`Invalid actorType. Expected one of: ${ACTOR_TYPES.join(', ')}`);
}

@ApiTags('Admin Sessions')
@Controller('admin/sessions')
@UseGuards(AdminAuthGuard, PermissionsGuard, StepUpGuard)
export class AdminSessionsController {
  constructor(
    private readonly service: AdminSessionsService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * List currently-active sessions across admins, users, sellers,
   * franchises, and affiliates. Filters: actorType, actorId, ipAddress.
   * Results are merged + sorted newest-first.
   *
   * Phase 209 (#7) — @Throttle (30/min/IP). The list joins five tables;
   * the cap blunts scripted enumeration of who's logged in.
   * Phase 209 (#14) — the active-session list is a surveillance surface;
   * each view writes a SESSIONS_VIEWED audit row.
   */
  @Get()
  @Permissions('sessions.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(
    @Query() query: SessionsListQueryDto,
    @Req() req: any,
  ) {
    const data = await this.service.list({
      actorType: parseActorType(query.actorType),
      actorId: query.actorId || undefined,
      ipAddress: query.ipAddress || undefined,
      limit: query.limit ?? 200,
    });

    // Phase 209 (#14) — audit the read. Best-effort; never blocks the view.
    this.audit
      .writeAuditLog({
        actorId: req?.adminId ?? req?.user?.id,
        actorRole: req?.adminRole ?? req?.user?.role,
        action: 'SESSIONS_VIEWED',
        module: 'security',
        resource: 'session',
        metadata: {
          filterActorType: query.actorType ?? null,
          filterActorId: query.actorId ?? null,
          filterIp: query.ipAddress ?? null,
          resultCount: data.items.length,
          total: data.total,
        },
        ipAddress: req?.ip,
        userAgent: req?.headers?.['user-agent'],
      })
      .catch(() => undefined);

    return { success: true, message: 'Active sessions', data };
  }

  /**
   * Force-logout a single session. Caller must specify `actorType`
   * via body so the service knows which table to update — session
   * ids are not globally unique across the five tables.
   */
  @Delete(':sessionId')
  @Permissions('sessions.revoke')
  // Phase 26 — revoking a session boots an actor mid-flight; 5-min
  // window to balance bulk ops with security.
  @RequiresStepUp()
  // Phase 27 (2026-05-21) — per-IP throttle. 50/60s leaves ops room
  // without letting a compromised admin token mass-revoke in seconds.
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  async revoke(
    @Param('sessionId') sessionId: string,
    @Body() body: RevokeSessionDto,
    @Req() req: any,
  ) {
    const actorType = parseActorType(body?.actorType);
    if (!actorType) {
      throw new BadRequestException('actorType is required in the request body');
    }
    // Phase 27 (2026-05-21) — fail closed if the guard didn't populate
    // adminId rather than poison the audit log with 'unknown'. (The
    // service ALSO rejects a missing/'unknown' revoker — Phase 209 #13 —
    // as a defence-in-depth backstop.)
    const revokedByAdminId = req?.adminId ?? req?.user?.id;
    if (!revokedByAdminId) {
      throw new BadRequestException('Admin identity missing — guard chain misconfigured');
    }
    const data = await this.service.revokeOne({
      sessionId,
      actorType,
      revokedByAdminId,
      revokedByAdminRole: req?.adminRole ?? req?.user?.role,
      reason: body?.reason,
    });
    return {
      success: true,
      message: data.alreadyRevoked
        ? 'Session was already revoked'
        : 'Session revoked',
      data,
    };
  }

  /**
   * Force-logout every active session for a given actor. Returns
   * the count revoked. Idempotent — calling twice after a revoke
   * returns 0 on the second call.
   */
  @Post('revoke-all/:actorType/:actorId')
  @Permissions('sessions.revoke')
  // Phase 26 — bulk revoke; higher blast radius, same 5-min window.
  @RequiresStepUp()
  // Phase 27 (2026-05-21) — tighter per-IP throttle on the bulk path.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async revokeAll(
    @Param('actorType') actorTypeRaw: string,
    @Param('actorId') actorId: string,
    @Body() body: RevokeAllSessionsDto = {},
    @Req() req: any,
  ) {
    const actorType = parseActorType(actorTypeRaw);
    if (!actorType) {
      throw new BadRequestException('actorType path segment is required');
    }
    const revokedByAdminId = req?.adminId ?? req?.user?.id;
    if (!revokedByAdminId) {
      throw new BadRequestException('Admin identity missing — guard chain misconfigured');
    }
    const data = await this.service.revokeAllForActor({
      actorType,
      actorId,
      revokedByAdminId,
      revokedByAdminRole: req?.adminRole ?? req?.user?.role,
      reason: body?.reason,
    });
    return { success: true, message: `Revoked ${data.revoked} session(s)`, data };
  }
}
