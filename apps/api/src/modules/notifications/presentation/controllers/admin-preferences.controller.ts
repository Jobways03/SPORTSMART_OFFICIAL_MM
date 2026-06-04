import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { NotificationChannel } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { AdminOverridePreferenceDto } from '../dtos/preferences.dtos';
import {
  NOTIFICATION_EVENT_CLASSES,
  NOTIFICATION_EVENT_CLASS_META,
  isKnownEventClass,
} from '../../domain/notification-event-class';

const SUPPORTED_CHANNELS: NotificationChannel[] = ['EMAIL', 'SMS', 'WHATSAPP'];
const OVERRIDE_SOURCES = ['ADMIN', 'COURT_ORDER', 'IMPORT'];

function adminActorId(req: any): string {
  const id = req?.adminId ?? req?.user?.id;
  if (!id) throw new UnauthorizedAppException('Admin identity not resolved');
  return id;
}

@ApiTags('Admin Notifications')
@Controller('admin/notifications/preferences')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminNotificationPreferencesController {
  constructor(
    private readonly facade: NotificationsPublicFacade,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Read a customer's preference grid (full grid with defaults materialized,
   * so support sees default-enabled cells too). Phase 189 (#11) — now gated
   * by notifications.preferences.read.
   */
  @Get(':userId')
  @Permissions('notifications.preferences.read')
  async list(@Param('userId') userId: string) {
    const stored = await this.facade.listPreferencesForUser(userId);
    const preferences = NOTIFICATION_EVENT_CLASSES.flatMap((eventClass) => {
      const meta = NOTIFICATION_EVENT_CLASS_META[eventClass]!;
      return SUPPORTED_CHANNELS.map((channel) => {
        const found = stored.find((p) => p.eventClass === eventClass && p.channel === channel);
        return {
          eventClass,
          channel,
          enabled: meta.locked ? true : (found?.enabled ?? true),
          locked: meta.locked,
          group: meta.group,
          source: found?.source ?? null,
        };
      });
    });
    return { success: true, message: 'Preferences retrieved', data: { preferences } };
  }

  /** Phase 189 (#9) — a customer's consent-change history for support triage. */
  @Get(':userId/history')
  @Permissions('notifications.preferences.read')
  async history(@Param('userId') userId: string) {
    const items = await this.facade.getPreferenceHistoryForUser(userId);
    return { success: true, message: 'Preference history', data: { items } };
  }

  /**
   * Phase 189 (#10) — legal/compliance override. Mirrors the raw-dispatch
   * pattern: CRITICAL-gated, mandatory bypassReason, fully audited. The ONLY
   * way an admin can change a customer's preference (a court-ordered notice,
   * a known-opt-in re-enrollment). Can force a locked class on/off — never
   * silently. Customer-initiated changes still flow through the customer API.
   */
  @Patch(':userId')
  @Permissions('notifications.preferences.override')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async override(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: AdminOverridePreferenceDto,
  ) {
    const actor = adminActorId(req);
    const source = (body.source ?? 'ADMIN').toUpperCase();
    if (!OVERRIDE_SOURCES.includes(source)) {
      throw new BadRequestAppException(`source must be one of: ${OVERRIDE_SOURCES.join(', ')}`);
    }
    for (const e of body.entries) {
      if (!isKnownEventClass(e.eventClass)) {
        throw new BadRequestAppException(`Unknown eventClass: ${e.eventClass}`);
      }
      if (!SUPPORTED_CHANNELS.includes(e.channel)) {
        throw new BadRequestAppException(`Unknown channel: ${e.channel}`);
      }
    }

    await this.facade.setPreferencesForUser(userId, body.entries, {
      source,
      updatedByAdminId: actor,
      bypassReason: body.bypassReason,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    await this.audit.writeAuditLog({
      actorId: actor,
      action: 'notifications.preferences.override',
      module: 'notifications',
      resource: 'NotificationPreference',
      resourceId: userId,
      newValue: { entries: body.entries, source, bypassReason: body.bypassReason },
      ipAddress: req.ip ?? undefined,
      userAgent: req.headers?.['user-agent'] ?? undefined,
    });
    return { success: true, message: 'Customer preferences overridden', data: { source } };
  }
}
