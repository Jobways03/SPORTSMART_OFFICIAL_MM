import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { NotificationChannel } from '@prisma/client';
import { UserAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotificationLogRepository } from '../../infrastructure/persistence/prisma/notification-log.repository';
import { UpdatePreferencesDto } from '../dtos/preferences.dtos';
// Phase 189 — single source of truth for classes + locked metadata.
import {
  NOTIFICATION_EVENT_CLASSES,
  NOTIFICATION_EVENT_CLASS_META,
  isKnownEventClass,
  isLockedEventClass,
  unlockedEventClasses,
} from '../../domain/notification-event-class';

const SUPPORTED_CHANNELS: NotificationChannel[] = ['EMAIL', 'SMS', 'WHATSAPP'];

@ApiTags('Notifications — Customer')
@Controller('customer/notifications')
@UseGuards(UserAuthGuard)
export class CustomerNotificationsController {
  constructor(
    private readonly facade: NotificationsPublicFacade,
    private readonly audit: AuditPublicFacade,
    // Phase 190 (#15) — customer-self notification history.
    private readonly logs: NotificationLogRepository,
  ) {}

  /**
   * Phase 190 (#15) — the customer's own notification history ("did I get
   * the OTP?"). Scoped to req.userId; returns metadata ONLY (no rendered
   * body — an old OTP/link must not be re-surfaced here).
   */
  @Get('messages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async messages(@Req() req: any) {
    const page = Math.max(1, Number.parseInt(req.query?.page ?? '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query?.limit ?? '20', 10) || 20));
    const result = await this.logs.listForRecipient({ recipientId: req.userId, page, limit });
    const items = (result.items as any[]).map((l) => ({
      id: l.id,
      channel: l.channel,
      status: l.status,
      subject: l.subject,
      eventType: l.eventType,
      createdAt: l.createdAt,
      sentAt: l.sentAt,
      deliveredAt: l.deliveredAt,
    }));
    return { success: true, message: 'Notification history', data: { ...result, items } };
  }

  @Get('preferences')
  async listPreferences(@Req() req: any) {
    const stored = await this.facade.listPreferencesForUser(req.userId);
    // Materialize the full grid (eventClass × channel) with metadata so the
    // UI can render locked rows as disabled (#1) and group them (#3).
    const preferences = NOTIFICATION_EVENT_CLASSES.flatMap((eventClass) => {
      const meta = NOTIFICATION_EVENT_CLASS_META[eventClass]!;
      return SUPPORTED_CHANNELS.map((channel) => {
        const found = stored.find((p) => p.eventClass === eventClass && p.channel === channel);
        return {
          eventClass,
          channel,
          // Locked classes are always reported enabled regardless of any row.
          enabled: meta.locked ? true : (found?.enabled ?? true),
          locked: meta.locked,
          group: meta.group,
          label: meta.label,
        };
      });
    });
    return {
      success: true,
      message: 'Preferences retrieved',
      data: {
        preferences,
        eventClasses: NOTIFICATION_EVENT_CLASSES,
        channels: SUPPORTED_CHANNELS,
        meta: NOTIFICATION_EVENT_CLASS_META,
      },
    };
  }

  @Patch('preferences')
  // Phase 189 (#13) — bound preference churn per customer.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setPreferences(@Req() req: any, @Body() body: UpdatePreferencesDto) {
    // #5 — invalid input now throws 400 (was 200 with success:false).
    for (const e of body.entries) {
      if (!isKnownEventClass(e.eventClass)) {
        throw new BadRequestAppException(`Unknown eventClass: ${e.eventClass}`);
      }
      if (!SUPPORTED_CHANNELS.includes(e.channel)) {
        throw new BadRequestAppException(`Unknown channel: ${e.channel}`);
      }
      // #1 — a customer may NOT disable a locked (security/account) class.
      if (isLockedEventClass(e.eventClass) && e.enabled === false) {
        throw new BadRequestAppException(
          `"${e.eventClass}" is an account-critical class and cannot be disabled.`,
        );
      }
    }

    await this.facade.setPreferencesForUser(req.userId, body.entries, {
      source: 'CUSTOMER',
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    // #8 — GDPR-demonstrable consent record.
    await this.audit.writeAuditLog({
      actorId: req.userId,
      actorRole: 'CUSTOMER',
      action: 'notifications.preferences.updated',
      module: 'notifications',
      resource: 'NotificationPreference',
      resourceId: req.userId,
      newValue: { entries: body.entries },
      ipAddress: req.ip ?? undefined,
      userAgent: req.headers?.['user-agent'] ?? undefined,
    });
    return { success: true, message: 'Preferences updated' };
  }

  /**
   * Phase 189 (#16) — one-click "mute everything I'm allowed to mute".
   * Disables every non-locked class across all channels; locked
   * (security/account) classes stay on.
   */
  @Post('preferences/opt-out-all')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async optOutAll(@Req() req: any) {
    const entries = unlockedEventClasses().flatMap((eventClass) =>
      SUPPORTED_CHANNELS.map((channel) => ({ eventClass, channel, enabled: false })),
    );
    await this.facade.setPreferencesForUser(req.userId, entries, {
      source: 'CUSTOMER',
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    await this.audit.writeAuditLog({
      actorId: req.userId,
      actorRole: 'CUSTOMER',
      action: 'notifications.preferences.opt_out_all',
      module: 'notifications',
      resource: 'NotificationPreference',
      resourceId: req.userId,
      ipAddress: req.ip ?? undefined,
      userAgent: req.headers?.['user-agent'] ?? undefined,
    });
    return {
      success: true,
      message: 'Opted out of all non-critical notifications',
      data: { mutedClasses: unlockedEventClasses() },
    };
  }

  /** Phase 189 (#9) — the customer's own consent-change history. */
  @Get('preferences/history')
  async history(@Req() req: any) {
    const items = await this.facade.getPreferenceHistoryForUser(req.userId);
    return { success: true, message: 'Preference history', data: { items } };
  }
}
