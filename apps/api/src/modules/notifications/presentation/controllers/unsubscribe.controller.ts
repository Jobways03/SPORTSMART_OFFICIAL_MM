import { Public } from '@core/decorators';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';
import { EmailUnsubscribeService } from '../../application/services/email-unsubscribe.service';
import { isKnownEventClass, isLockedEventClass } from '../../domain/notification-event-class';

/**
 * Phase 189 (#14) — public one-click unsubscribe landing.
 *
 *   GET /api/v1/notifications/unsubscribe?token=...
 *
 * No auth (clicked from an email), but the HMAC token binds it to one
 * (userId, eventClass, channel). Flips that preference to disabled with
 * source=UNSUBSCRIBE_LINK + a history row, then renders a tiny confirmation
 * page. A locked (security/account) class is never unsubscribable.
 */
@ApiTags('Notifications — Public')
@Public()
@Controller('notifications')
export class NotificationUnsubscribeController {
  constructor(
    private readonly facade: NotificationsPublicFacade,
    private readonly unsubscribe: EmailUnsubscribeService,
  ) {}

  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async handle(@Query('token') token?: string): Promise<string> {
    const payload = token ? this.unsubscribe.verify(token) : null;
    if (!payload) {
      return this.page('Invalid or expired unsubscribe link', 'This link could not be verified. Please manage your preferences from your account.');
    }
    if (!isKnownEventClass(payload.eventClass) || isLockedEventClass(payload.eventClass)) {
      return this.page(
        'This notification cannot be unsubscribed',
        'Account-critical and security notifications cannot be turned off.',
      );
    }

    await this.facade.setPreferencesForUser(
      payload.userId,
      [{ eventClass: payload.eventClass, channel: payload.channel, enabled: false }],
      { source: 'UNSUBSCRIBE_LINK' },
    );
    return this.page(
      'You have been unsubscribed',
      `You will no longer receive ${payload.eventClass} notifications on ${payload.channel.toLowerCase()}. ` +
        `You can re-enable them anytime from your account notification settings.`,
    );
  }

  private page(title: string, body: string): string {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#0F1115">
<h2 style="color:#0F1115">SPORTSMART</h2>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
<h3 style="margin-top:0">${esc(title)}</h3><p style="color:#475569">${esc(body)}</p></div>
</body></html>`;
  }
}
