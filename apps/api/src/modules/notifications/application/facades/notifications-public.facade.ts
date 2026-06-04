import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import {
  INotificationQueue,
  NOTIFICATION_QUEUE,
} from '../ports/notification-queue.port';
import { TemplateRegistry } from '../services/template-registry.service';
import { TemplateRenderer } from '../services/template-renderer.service';
import { NotificationPreferenceRepository } from '../../infrastructure/persistence/prisma/notification-preference.repository';
import { NotificationLogRepository } from '../../infrastructure/persistence/prisma/notification-log.repository';

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
    private readonly logRepo: NotificationLogRepository,
  ) {}

  // ── Phase 185 (#12) — DLQ ops surface ─────────────────────────────────
  /** Queue depth snapshot (ready / delayed / dead-letter). */
  getQueueStats() {
    return this.queue.getStats();
  }
  listDeadLetters(offset: number, limit: number) {
    return this.queue.listDeadLetters(offset, limit);
  }
  replayDeadLetter(index: number) {
    return this.queue.replayDeadLetter(index);
  }
  /**
   * Discard a dead-letter and record a CANCELLED log row (#5). Returns true
   * when an entry was found+cancelled.
   */
  async discardDeadLetter(index: number, reason: string): Promise<boolean> {
    const entry = await this.queue.discardDeadLetter(index);
    if (!entry) return false;
    await this.logRepo.recordCancellation(
      entry.job,
      `Cancelled by admin from DLQ: ${reason}`.slice(0, 500),
    );
    return true;
  }

  // ── Phase 185 (#5) — delivery receipts ────────────────────────────────
  /** Flip SENT → DELIVERED on a carrier delivery-receipt. */
  recordDeliveryReceipt(providerMessageId: string, deliveredAt: Date) {
    return this.logRepo.markDelivered(providerMessageId, deliveredAt);
  }

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
    /** Phase 185 (#17) — provenance; defaults to EVENT_BUS:<eventClass>. */
    triggerSource?: string;
  }): Promise<string> {
    const template = await this.registry.get(args.templateKey);
    if (!template) {
      this.logger.warn(`Template ${args.templateKey} not found — dropping`);
      return '';
    }

    // Best-effort enqueue-time early-out: if the user has already opted out
    // of (eventClass, channel) we can skip the queue round-trip. This is NOT
    // the authoritative suppression check — it sees only the preference
    // store, not the suppression list / DPDP consent / WhatsApp STOP, and it
    // races against changes made between enqueue and send. The LOAD-BEARING
    // chokepoint is NotificationGateService.check(), now invoked at send time
    // in NotificationWorker.handle() for every queue-driven dispatch. We keep
    // this cheap pre-filter purely to avoid churning the queue for the common
    // already-opted-out case.
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

    // Phase 185 (#14) — strip internal-only payload fields BEFORE render so
    // admin context (riskScore, internalNotes, _*) can never leak into a
    // customer-facing message. Default-on (template.customerVisibleOnly).
    const vars =
      template.customerVisibleOnly === false
        ? args.vars
        : TemplateRenderer.stripInternalVars(args.vars);

    // Phase 185 (#6) — fail fast on missing required vars rather than
    // shipping "Hi {{customerName}}". Only enforced when the template
    // declares a variablesSchema.
    const missing = this.renderer.findMissingRequiredVars(
      template.variablesSchema,
      vars,
    );
    if (missing.length > 0) {
      this.logger.warn(
        `Dropping ${args.templateKey} → ${args.recipientId}: missing required vars [${missing.join(', ')}]`,
      );
      return '';
    }

    // Phase 188 (#8) — channel-aware rendering: SMS/WhatsApp get plain text
    // (no HTML entity escaping), EMAIL gets HTML escaping.
    const subject = template.subject
      ? this.renderer.render(template.subject, vars, { channel: template.channel })
      : undefined;
    const body = this.renderer.render(template.body, vars, { channel: template.channel });

    return this.queue.enqueue({
      channel: template.channel,
      recipientId: args.recipientId,
      templateKey: args.templateKey,
      subject,
      body,
      eventType: args.eventClass,
      eventId: args.eventId,
      triggerSource: args.triggerSource ?? `EVENT_BUS:${args.eventClass}`,
      // Phase 185 (#4) — DLT ids resolved from the template for SMS.
      dltTemplateId: template.dltTemplateId ?? null,
      dltHeaderId: template.dltHeaderId ?? null,
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
    triggerSource?: string;
    dltTemplateId?: string | null;
    dltHeaderId?: string | null;
    // Phase 190 (#4) — trace linkage (e.g. retry → original log id).
    parentLogId?: string | null;
    outboxEventId?: string | null;
    /**
     * Cluster-D — safety-critical send. The send-time gate bypasses user
     * preference + DPDP marketing-consent for these (suppression list +
     * WhatsApp STOP still hard-block). Use for OTP / password reset / refund
     * credited and for deliberate admin opt-out-bypass dispatches.
     */
    transactional?: boolean;
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
      triggerSource: args.triggerSource ?? (args.eventType ? `EVENT_BUS:${args.eventType}` : undefined),
      dltTemplateId: args.dltTemplateId ?? null,
      dltHeaderId: args.dltHeaderId ?? null,
      parentLogId: args.parentLogId ?? null,
      outboxEventId: args.outboxEventId ?? null,
      transactional: args.transactional,
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

  /**
   * Bulk upsert with consent trail (Phase 189). `ctx` carries the change
   * provenance (source, admin actor, IP/UA) for the GDPR-demonstrable
   * history; all entries + history rows commit atomically.
   */
  setPreferencesForUser(
    userId: string,
    entries: Array<{ eventClass: string; channel: NotificationChannel; enabled: boolean }>,
    ctx: {
      source: string;
      updatedByAdminId?: string | null;
      bypassReason?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ) {
    return this.preferences.setMany(userId, entries, ctx);
  }

  /** Phase 189 (#9) — consent-change history for a user. */
  getPreferenceHistoryForUser(userId: string) {
    return this.preferences.historyForUser(userId);
  }
}
