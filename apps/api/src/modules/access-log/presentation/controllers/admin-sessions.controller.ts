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
import {
  AdminSessionsService,
  ActorType,
} from '../../application/services/admin-sessions.service';

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
  constructor(private readonly service: AdminSessionsService) {}

  /**
   * List currently-active sessions across admins, users, sellers,
   * and franchises. Filters: actorType (one of the four), actorId
   * (scope to one user), ipAddress (find a specific device). Results
   * are merged + sorted newest-first.
   */
  @Get()
  @Permissions('sessions.read')
  async list(
    @Query('actorType') actorType?: string,
    @Query('actorId') actorId?: string,
    @Query('ipAddress') ipAddress?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.list({
      actorType: parseActorType(actorType),
      actorId: actorId || undefined,
      ipAddress: ipAddress || undefined,
      limit: limit ? parseInt(limit, 10) : 200,
    });
    return { success: true, message: 'Active sessions', data };
  }

  /**
   * Force-logout a single session. Caller must specify `actorType`
   * via body so the service knows which table to update — session
   * ids are not globally unique across the four tables.
   */
  @Delete(':sessionId')
  @Permissions('sessions.revoke')
  // Phase 26 — revoking a session boots an actor mid-flight; 5-min
  // window to balance bulk ops with security.
  @RequiresStepUp()
  // Phase 27 (2026-05-21) — per-IP throttle. With step-up already
  // gating each revoke, the realistic burst is incident-response
  // batch-revokes (~tens per minute, not hundreds). 50/60s leaves
  // ops room without letting a compromised admin token mass-revoke
  // every session in seconds.
  @Throttle({ default: { limit: 50, ttl: 60_000 } })
  async revoke(
    @Param('sessionId') sessionId: string,
    @Body() body: { actorType: string; reason?: string },
    @Req() req: any,
  ) {
    const actorType = parseActorType(body?.actorType);
    if (!actorType) {
      throw new BadRequestException('actorType is required in the request body');
    }
    // Phase 27 (2026-05-21) — fail closed if the guard didn't populate
    // adminId. Pre-Phase-27 the fallback was `req.userId ?? req.user?.id
    // ?? 'unknown'`, which masked a misconfigured guard chain: a
    // request reaching this handler with neither field set would
    // silently audit-log "revoked by 'unknown'". AdminAuthGuard runs
    // at the class level and sets req.adminId on every successful
    // call; if that didn't happen, surface the error rather than
    // poison the audit log.
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
    return { success: true, message: 'Session revoked', data };
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
  // Bulk revoke is one call per target actor (not per session), so a
  // legitimate operator pattern is "revoke a small number of
  // compromised accounts." 10/60s is generous for that and tight
  // against a compromised-admin-token mass-revoke.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async revokeAll(
    @Param('actorType') actorTypeRaw: string,
    @Param('actorId') actorId: string,
    @Body() body: { reason?: string } = {},
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
