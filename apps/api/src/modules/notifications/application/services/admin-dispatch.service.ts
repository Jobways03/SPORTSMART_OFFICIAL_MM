import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AdminDispatchAlertType,
  NotificationChannel,
  NotificationDispatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { sanitizeEmailTemplateBody } from '../../../../core/utils/rich-text-sanitizer';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';
import { RecipientResolverService } from './recipient-resolver.service';
import { TemplateRegistry } from './template-registry.service';
import { NOTIFICATION_EVENT_CLASSES } from '../../domain/notification-event-class';

export interface DispatchResult {
  jobId: string | null;
  eventId: string;
  status: NotificationDispatchStatus;
  deduped: boolean;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{10,15}$/;

/**
 * Phase 187 — admin one-off dispatch orchestration.
 *
 * Wraps the two dispatch paths with the compliance controls the audit
 * requires but the bare facade calls lacked:
 *   #3  actor capture (dispatchedByAdminId) + audit_logs row
 *   #4  raw path requires alertType + bypassReason
 *   #7  a NotificationDispatch audit row per dispatch
 *   #8  idempotency: eventId (from idempotencyKey) is unique → dedup
 *   #10 recipient existence check (404 instead of silent drop) + snapshot
 *   #11 marketing can't ride the raw path (no marketing alertType)
 *   #12 template path requires a REGISTERED eventClass (opt-out honoured)
 *   #13 raw bypass prepends an "account notice" banner + flags bypassOptOut
 *   #15 raw EMAIL body is sanitised
 *   #17 raw `to` is validated as email/phone for the channel
 */
@Injectable()
export class AdminDispatchService {
  private readonly logger = new Logger(AdminDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsPublicFacade,
    private readonly recipients: RecipientResolverService,
    private readonly registry: TemplateRegistry,
    private readonly audit: AuditPublicFacade,
  ) {}

  // ── Template path ─────────────────────────────────────────────────────
  async dispatchTemplate(input: {
    adminId: string;
    templateKey: string;
    recipientId: string;
    vars?: Record<string, unknown>;
    eventClass?: string;
    idempotencyKey?: string;
  }): Promise<DispatchResult> {
    const eventId = this.eventId(input.idempotencyKey);
    const dup = await this.findExisting(eventId);
    if (dup) return dup;

    // #12 — a template dispatch MUST classify itself with a registered
    // eventClass so the gate's opt-out check is meaningful. The old default
    // 'admin.manual' was an unregistered class → opt-out silently bypassed.
    const eventClass = (input.eventClass ?? '').trim();
    if (!NOTIFICATION_EVENT_CLASSES.includes(eventClass as never)) {
      throw new BadRequestAppException(
        `eventClass is required for a template dispatch and must be one of: ` +
          `${NOTIFICATION_EVENT_CLASSES.join(', ')}.`,
      );
    }

    // Resolve the template channel up-front (for recipient resolution +
    // the dispatch snapshot). A missing template is recorded as SUPPRESSED.
    const template = await this.registry.get(input.templateKey);
    if (!template) {
      await this.recordDispatch({
        eventId,
        adminId: input.adminId,
        dispatchPath: 'TEMPLATE',
        channel: 'EMAIL',
        templateKey: input.templateKey,
        eventClass,
        recipientId: input.recipientId,
        destination: null,
        bypassOptOut: false,
        jobId: null,
        status: 'SUPPRESSED',
      });
      return {
        jobId: null, eventId, status: 'SUPPRESSED', deduped: false,
        message: `Notification suppressed: no template "${input.templateKey}"`,
      };
    }
    const channel = template.channel;

    // #10 — recipient must exist; snapshot the contact for the audit row.
    const recip = await this.recipients.resolve(input.recipientId, channel);
    if (!recip.found) {
      throw new NotFoundAppException(`Unknown recipient "${input.recipientId}"`);
    }

    const jobId = await this.notifications.notifyFromTemplate({
      eventClass,
      templateKey: input.templateKey,
      recipientId: input.recipientId,
      vars: input.vars ?? {},
      eventId,
      triggerSource: 'ADMIN_DISPATCH',
    });
    const status: NotificationDispatchStatus = jobId ? 'ENQUEUED' : 'SUPPRESSED';

    await this.recordDispatch({
      eventId,
      adminId: input.adminId,
      dispatchPath: 'TEMPLATE',
      channel,
      templateKey: input.templateKey,
      eventClass,
      recipientId: input.recipientId,
      destination: recip.destination,
      bypassOptOut: false,
      jobId: jobId || null,
      status,
    });
    await this.writeAudit(input.adminId, 'notifications.dispatch.template', eventId, {
      templateKey: input.templateKey,
      eventClass,
      recipientId: input.recipientId,
      status,
    });

    return {
      jobId: jobId || null,
      eventId,
      status,
      deduped: false,
      message:
        status === 'ENQUEUED'
          ? 'Notification enqueued from template'
          : 'Notification suppressed: recipient opted out, template missing, or a required variable was absent',
    };
  }

  // ── Raw path ──────────────────────────────────────────────────────────
  async dispatchRaw(input: {
    adminId: string;
    channel: NotificationChannel;
    recipientId?: string;
    to?: string;
    subject?: string;
    body: string;
    alertType: AdminDispatchAlertType;
    bypassReason: string;
    confirmed: boolean;
    idempotencyKey?: string;
  }): Promise<DispatchResult> {
    // #14 — backend confirmation gate (a direct API call can't skip the modal).
    if (input.confirmed !== true) {
      throw new BadRequestAppException(
        'Raw dispatch requires explicit confirmation (confirmed=true).',
      );
    }

    const eventId = this.eventId(input.idempotencyKey);
    const dup = await this.findExisting(eventId);
    if (dup) return dup;

    if (!input.recipientId && !input.to) {
      throw new BadRequestAppException('either recipientId or to is required');
    }

    // #10/#17 — resolve + validate the destination.
    let destination: string | null;
    if (input.recipientId) {
      const recip = await this.recipients.resolve(input.recipientId, input.channel);
      if (!recip.found) {
        throw new NotFoundAppException(`Unknown recipient "${input.recipientId}"`);
      }
      if (!recip.destination) {
        throw new BadRequestAppException(
          `Recipient "${input.recipientId}" has no ${input.channel} contact on file.`,
        );
      }
      destination = recip.destination;
    } else {
      destination = this.assertValidDestination(input.to!, input.channel);
    }

    // #15 — sanitise admin-authored HTML for EMAIL; #13 — prepend an
    // account-notice banner so the customer knows this is an admin override.
    const safeBody = input.channel === 'EMAIL' ? sanitizeEmailTemplateBody(input.body) : input.body;
    const finalBody = this.withAccountNotice(safeBody, input.channel);

    const jobId = await this.notifications.notify({
      channel: input.channel,
      recipientId: input.recipientId,
      to: input.recipientId ? undefined : input.to,
      subject: input.subject,
      body: finalBody,
      // #12 (raw) — alertType is a meaningful eventType (was weak 'admin.manual').
      eventType: `admin.raw.${input.alertType.toLowerCase()}`,
      eventId,
      triggerSource: 'ADMIN_DISPATCH',
      // Cluster-D — the raw path is an explicit, audited opt-out bypass
      // (bypassOptOut=true above) and already prepends an account-notice
      // banner, so it rides the send-time gate's transactional bypass for
      // user-preference/consent. The suppression list + WhatsApp STOP still
      // hard-block — an admin can't force a send to a bounced/compliance-
      // suppressed address.
      transactional: true,
    });

    await this.recordDispatch({
      eventId,
      adminId: input.adminId,
      dispatchPath: 'RAW',
      channel: input.channel,
      rawSubject: input.subject ?? null,
      rawBody: finalBody,
      recipientId: input.recipientId ?? null,
      destination,
      bypassOptOut: true,
      bypassReason: input.bypassReason,
      alertType: input.alertType,
      jobId: jobId || null,
      status: jobId ? 'ENQUEUED' : 'FAILED',
    });
    await this.writeAudit(input.adminId, 'notifications.dispatch.raw', eventId, {
      channel: input.channel,
      recipientId: input.recipientId ?? null,
      destination,
      alertType: input.alertType,
      bypassReason: input.bypassReason,
    });

    return {
      jobId: jobId || null,
      eventId,
      status: jobId ? 'ENQUEUED' : 'FAILED',
      deduped: false,
      message: 'Notification enqueued (raw, opt-out bypassed)',
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private eventId(idempotencyKey?: string): string {
    return `admin-dispatch-${idempotencyKey ?? randomUUID()}`;
  }

  private async findExisting(eventId: string): Promise<DispatchResult | null> {
    const row = await this.prisma.notificationDispatch.findUnique({ where: { eventId } });
    if (!row) return null;
    return {
      jobId: row.jobId,
      eventId,
      status: row.status,
      deduped: true,
      message: 'Duplicate dispatch — returning the original result',
    };
  }

  private assertValidDestination(to: string, channel: NotificationChannel): string {
    const value = to.trim();
    if (channel === 'EMAIL') {
      if (!EMAIL_RE.test(value)) {
        throw new BadRequestAppException(`"${to}" is not a valid email address.`);
      }
    } else {
      const digits = value.replace(/[\s-]/g, '');
      if (!PHONE_RE.test(digits)) {
        throw new BadRequestAppException(`"${to}" is not a valid phone number.`);
      }
    }
    return value;
  }

  /** #13 — opt-out-bypass account-notice banner. */
  private withAccountNotice(body: string, channel: NotificationChannel): string {
    if (channel === 'EMAIL') {
      return (
        `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;` +
        `padding:10px 14px;margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#92400e">` +
        `<strong>Important account notice</strong> — this is a service message about your account.</div>` +
        body
      );
    }
    return `[Account notice] ${body}`;
  }

  private async recordDispatch(data: {
    eventId: string;
    adminId: string;
    dispatchPath: 'TEMPLATE' | 'RAW';
    channel: NotificationChannel;
    templateKey?: string | null;
    eventClass?: string | null;
    rawSubject?: string | null;
    rawBody?: string | null;
    recipientId?: string | null;
    destination: string | null;
    bypassOptOut: boolean;
    bypassReason?: string | null;
    alertType?: AdminDispatchAlertType | null;
    jobId: string | null;
    status: NotificationDispatchStatus;
  }): Promise<void> {
    try {
      await this.prisma.notificationDispatch.create({
        data: {
          eventId: data.eventId,
          dispatchedByAdminId: data.adminId,
          dispatchPath: data.dispatchPath,
          channel: data.channel,
          templateKey: data.templateKey ?? null,
          eventClass: data.eventClass ?? null,
          rawSubject: data.rawSubject ?? null,
          rawBody: data.rawBody ?? null,
          recipientId: data.recipientId ?? null,
          destination: data.destination,
          bypassOptOut: data.bypassOptOut,
          bypassReason: data.bypassReason ?? null,
          alertType: data.alertType ?? null,
          jobId: data.jobId,
          status: data.status,
        },
      });
    } catch (err) {
      // A unique-violation here means a concurrent duplicate already wrote
      // the row — safe to ignore (the dedup pre-check raced). Anything else
      // we log but don't fail the dispatch the customer already received.
      this.logger.warn(
        `Failed to write NotificationDispatch for ${data.eventId}: ${(err as Error).message}`,
      );
    }
  }

  private async writeAudit(
    adminId: string,
    action: string,
    eventId: string,
    newValue: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.writeAuditLog({
      actorId: adminId,
      action,
      module: 'notifications',
      resource: 'NotificationDispatch',
      resourceId: eventId,
      newValue,
    });
  }
}
