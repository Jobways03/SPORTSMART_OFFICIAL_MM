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
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  AdminSessionsService,
  ActorType,
} from '../../application/services/admin-sessions.service';

const ACTOR_TYPES: readonly ActorType[] = ['ADMIN', 'USER', 'SELLER', 'FRANCHISE'];

function parseActorType(raw: string | undefined): ActorType | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if ((ACTOR_TYPES as readonly string[]).includes(upper)) return upper as ActorType;
  throw new BadRequestException(`Invalid actorType. Expected one of: ${ACTOR_TYPES.join(', ')}`);
}

@ApiTags('Admin Sessions')
@Controller('admin/sessions')
@UseGuards(AdminAuthGuard, PermissionsGuard)
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
  async revoke(
    @Param('sessionId') sessionId: string,
    @Body() body: { actorType: string; reason?: string },
    @Req() req: any,
  ) {
    const actorType = parseActorType(body?.actorType);
    if (!actorType) {
      throw new BadRequestException('actorType is required in the request body');
    }
    const data = await this.service.revokeOne({
      sessionId,
      actorType,
      revokedByAdminId: req?.userId ?? req?.user?.id ?? 'unknown',
      revokedByAdminRole: req?.user?.role ?? req?.adminRole,
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
    const data = await this.service.revokeAllForActor({
      actorType,
      actorId,
      revokedByAdminId: req?.userId ?? req?.user?.id ?? 'unknown',
      revokedByAdminRole: req?.user?.role ?? req?.adminRole,
      reason: body?.reason,
    });
    return { success: true, message: `Revoked ${data.revoked} session(s)`, data };
  }
}
