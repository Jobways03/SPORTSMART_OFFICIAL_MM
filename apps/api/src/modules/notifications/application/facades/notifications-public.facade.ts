import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import {
  INotificationQueue,
  NOTIFICATION_QUEUE,
} from '../ports/notification-queue.port';
import { TemplateRegistry } from '../services/template-registry.service';
import { TemplateRenderer } from '../services/template-renderer.service';
import { NotificationPreferenceRepository } from '../../infrastructure/persistence/prisma/notification-preference.repository';

/**
 * Single entry point for every other module that wants to send a
 * notification. Always asynchronous: enqueues the job and returns
 * immediately. The worker (`NotificationWorker`) handles dispatch +
 * retries + audit logging.
 *
 * Three surfaces:
 * - `notifyFromTemplate(...)` — preferred. Looks up template by key,
 *   checks the recipient's preferences, renders, enqueues.
 * - `notify(...)` — channel-agnostic raw send (no template lookup).
 * - Legacy `sendNotification` / `sendTemplatedCommunication` /
 *   `sendOperationalReminder` shims — kept so existing event-handlers
 *   continue to work without edits.
 */
@Injectable()
export class NotificationsPublicFacade {
  private readonly logger = new Logger(NotificationsPublicFacade.name);

  constructor(
    @Inject(NOTIFICATION_QUEUE) private readonly queue: INotificationQueue,
    private readonly registry: TemplateRegistry,
    private readonly renderer: TemplateRenderer,
    private readonly preferences: NotificationPreferenceRepository,
  ) {}

  /**
   * Enqueue a notification rendered from a template.
   *
   * @param args.eventClass — coarse class for opt-out checks: order,
   *   refund, ticket, wallet, marketing, …
   * @param args.templateKey — registry key, e.g. "order.placed.email"
   * @param args.recipientId — User/Seller/Admin/Franchise/Affiliate id
   *   (worker resolves email/phone)
   * @param args.vars — Handlebars vars substituted into subject + body
   * @param args.eventId — optional id of the upstream event for audit
   */
  async notifyFromTemplate(args: {
    eventClass: string;
    templateKey: string;
    recipientId: string;
    vars: Record<string, unknown>;
    eventId?: string;
  }): Promise<string> {
    const template = await this.registry.get(args.templateKey);
    if (!template) {
      this.logger.warn(`Template ${args.templateKey} not found — dropping`);
      return '';
    }

    // Preference check: only consult for non-marketing transactional
    // notifications; admin override is via the user explicitly opting
    // out per (eventClass, channel) in /account/notifications.
    const enabled = await this.preferences.isEnabled({
      userId: args.recipientId,
      eventClass: args.eventClass,
      channel: template.channel,
    });
    if (!enabled) {
      this.logger.log(
        `Suppressed ${args.templateKey} → ${args.recipientId} (user opted out of ${args.eventClass}/${template.channel})`,
      );
      return '';
    }

    const subject = template.subject
      ? this.renderer.render(template.subject, args.vars)
      : undefined;
    const body = this.renderer.render(template.body, args.vars);

    return this.queue.enqueue({
      channel: template.channel,
      recipientId: args.recipientId,
      templateKey: args.templateKey,
      subject,
      body,
      eventType: args.eventClass,
      eventId: args.eventId,
    });
  }

  /**
   * Enqueue a notification with raw subject/body (no template lookup).
   * The worker resolves the recipient's address (email/phone) when
   * `recipientId` is given; otherwise pass `to` directly.
   */
  async notify(args: {
    channel: NotificationChannel;
    recipientId?: string;
    to?: string;
    templateKey?: string;
    subject?: string;
    body: string;
    eventType?: string;
    eventId?: string;
  }): Promise<string> {
    if (!args.recipientId && !args.to) {
      this.logger.warn('notify() called without recipientId or to — dropping job');
      return '';
    }
    return this.queue.enqueue({
      channel: args.channel,
      recipientId: args.recipientId,
      destination: args.to,
      templateKey: args.templateKey,
      subject: args.subject,
      body: args.body,
      eventType: args.eventType,
      eventId: args.eventId,
    });
  }

  // ── Legacy compatibility shims ────────────────────────────────────
  // Existing event-handlers still call these; they now route through
  // the queue without changing call sites.

  async sendNotification(params: {
    recipientId: string;
    channel: string;
    templateKey: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const channel = (params.channel || 'email').toUpperCase() as NotificationChannel;
    if (channel !== 'EMAIL' && channel !== 'SMS' && channel !== 'WHATSAPP') {
      this.logger.warn(`Unsupported channel "${params.channel}" — dropping`);
      return;
    }
    await this.notify({
      channel,
      recipientId: params.recipientId,
      templateKey: params.templateKey,
      subject: (params.data.subject as string) ?? params.templateKey,
      body: (params.data.body as string) ?? `Notification: ${params.templateKey}`,
    });
  }

  async sendTemplatedCommunication(
    templateId: string,
    recipientId: string,
    variables: Record<string, unknown>,
  ): Promise<void> {
    let html = `<h2>${variables.title ?? templateId}</h2>`;
    if (variables.message) html += `<p>${variables.message}</p>`;
    if (variables.actionUrl) {
      html += `<p><a href="${variables.actionUrl}">${variables.actionLabel ?? 'Click here'}</a></p>`;
    }
    await this.notify({
      channel: 'EMAIL',
      recipientId,
      templateKey: templateId,
      subject: (variables.subject as string) ?? templateId,
      body: html,
    });
  }

  async sendOperationalReminder(params: {
    recipientId: string;
    subject: string;
    message: string;
  }): Promise<void> {
    await this.notify({
      channel: 'EMAIL',
      recipientId: params.recipientId,
      templateKey: 'operational_reminder',
      subject: params.subject || 'Operational Reminder',
      body: `<p>${params.message}</p>`,
    });
  }

  /** Used by the customer API to render the preferences page. */
  listPreferencesForUser(userId: string) {
    return this.preferences.listForUser(userId);
  }

  /** Bulk upsert called by the customer settings page. */
  setPreferencesForUser(
    userId: string,
    entries: Array<{ eventClass: string; channel: NotificationChannel; enabled: boolean }>,
  ) {
    return this.preferences.setMany(userId, entries);
  }
}
