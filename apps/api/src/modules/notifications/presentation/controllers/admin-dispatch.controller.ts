import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { NotificationChannel } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';

/**
 * Manual one-off dispatch. The escape hatch for ops when the auto-send
 * pipeline either suppressed a notification or never fired.
 *
 * Two body shapes (discriminated on `templateKey`):
 *
 *   Template path (preferred):
 *     { templateKey, recipientId, vars?, eventClass? }
 *     → routes through notifyFromTemplate (looks up template, renders
 *       via Handlebars, respects user opt-out preferences).
 *
 *   Raw path (escape hatch):
 *     { channel, recipientId?, to?, subject?, body, eventType? }
 *     → routes through notify (no template, bypasses opt-out — use
 *       only when the recipient must receive this regardless of
 *       preferences, e.g. account-security alerts).
 *
 * Distinct from `/admin/notifications/logs/:id/retry` — that one
 * re-enqueues a previously-sent log row. This one creates a brand-new
 * dispatch from scratch.
 */
@ApiTags('Admin Notifications')
@Controller('admin/notifications')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('notifications.write')
export class AdminNotificationDispatchController {
  constructor(private readonly notifications: NotificationsPublicFacade) {}

  @Post('dispatch')
  async dispatch(@Body() body: DispatchBody) {
    const eventId = `admin-dispatch-${randomUUID()}`;

    // Template path
    if (body.templateKey) {
      if (!body.recipientId) {
        throw new BadRequestAppException(
          'recipientId is required when dispatching by templateKey',
        );
      }
      const jobId = await this.notifications.notifyFromTemplate({
        eventClass: body.eventClass ?? 'admin.manual',
        templateKey: body.templateKey,
        recipientId: body.recipientId,
        vars: body.vars ?? {},
        eventId,
      });
      if (!jobId) {
        // Suppressed at the facade — either the template doesn't exist
        // or the recipient opted out of this event class on this
        // channel. Surface both as 400 with a clear reason so ops can
        // either fix the template key or use the raw path to override.
        throw new BadRequestAppException(
          'Notification suppressed: template not found, or recipient has opted out of this event class on this channel',
        );
      }
      return {
        success: true,
        message: 'Notification enqueued from template',
        data: { jobId, eventId },
      };
    }

    // Raw path — operator must provide channel + destination + body.
    if (!body.channel) {
      throw new BadRequestAppException(
        'channel is required when dispatching without a templateKey',
      );
    }
    if (!body.body?.trim()) {
      throw new BadRequestAppException(
        'body is required when dispatching without a templateKey',
      );
    }
    if (!body.recipientId && !body.to) {
      throw new BadRequestAppException(
        'either recipientId or to is required',
      );
    }

    const jobId = await this.notifications.notify({
      channel: body.channel,
      recipientId: body.recipientId,
      to: body.to,
      subject: body.subject,
      body: body.body,
      eventType: body.eventType ?? 'admin.manual',
      eventId,
    });
    return {
      success: true,
      message: 'Notification enqueued (raw)',
      data: { jobId, eventId },
    };
  }
}

interface DispatchBody {
  // Template path
  templateKey?: string;
  vars?: Record<string, unknown>;
  eventClass?: string;

  // Raw path
  channel?: NotificationChannel;
  subject?: string;
  body?: string;
  eventType?: string;

  // Shared
  recipientId?: string;
  to?: string;
}
