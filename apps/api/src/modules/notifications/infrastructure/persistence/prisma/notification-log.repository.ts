import { Injectable } from '@nestjs/common';
import type {
  NotificationChannel,
  NotificationFailureCode,
  NotificationLog,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import type { NotificationJob } from '../../../application/ports/notification-queue.port';
import type { SendResult } from '../../../application/ports/notification-provider.port';

@Injectable()
export class NotificationLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Insert a row for a completed attempt (success or failure). */
  async recordAttempt(args: {
    job: NotificationJob;
    destination: string;
    result: SendResult;
    finalStatus: 'SENT' | 'FAILED' | 'RETRY' | 'DEAD_LETTERED';
  }): Promise<NotificationLog> {
    const { job, destination, result, finalStatus } = args;
    const isFailure = finalStatus === 'FAILED' || finalStatus === 'DEAD_LETTERED';
    const now = new Date();
    return this.prisma.notificationLog.create({
      data: {
        channel: job.channel,
        status: finalStatus,
        recipientId: job.recipientId ?? null,
        destination,
        templateKey: job.templateKey ?? null,
        subject: job.subject ?? null,
        body: job.body,
        eventType: job.eventType ?? null,
        eventId: job.eventId ?? null,
        // Phase 185 (#17) — provenance for trace.
        triggerSource: job.triggerSource ?? null,
        // Phase 190 (#4) — soft trace linkage.
        parentLogId: job.parentLogId ?? null,
        outboxEventId: job.outboxEventId ?? null,
        providerMessageId: result.providerMessageId ?? null,
        failureReason: result.failureReason ?? null,
        // Phase 190 (#5/#6) — structured failure + provider capture.
        provider: result.provider ?? null,
        providerResponseSummary: result.providerResponse
          ? (result.providerResponse as Prisma.InputJsonValue)
          : undefined,
        failureCode: isFailure
          ? (NotificationLogRepository.deriveFailureCode(result) as NotificationFailureCode)
          : null,
        attemptNumber: job.attemptNumber,
        sentAt: finalStatus === 'SENT' ? now : null,
        // Phase 190 (#7) — distinct terminal-failure timestamp.
        failedAt: isFailure ? now : null,
      },
    });
  }

  /**
   * Phase 190 (#6) — derive a canonical NotificationFailureCode from the
   * provider result. Prefers the provider's own code; otherwise infers from
   * the free-text reason (keyword heuristics).
   */
  private static deriveFailureCode(result: SendResult): string {
    const VALID = new Set([
      'INVALID_EMAIL', 'INVALID_PHONE', 'BOUNCED', 'SPAM_COMPLAINT', 'RATE_LIMITED',
      'PROVIDER_ERROR', 'AUTH_FAILED', 'NETWORK_TIMEOUT', 'BLOCKED_BY_SUPPRESSION',
      'BLOCKED_BY_PREFERENCE', 'MALFORMED_TEMPLATE', 'NOT_CONFIGURED', 'UNKNOWN',
    ]);
    if (result.failureCode && VALID.has(result.failureCode)) return result.failureCode;
    const r = (result.failureReason ?? '').toLowerCase();
    if (/\bbounce/.test(r)) return 'BOUNCED';
    if (/spam|complaint/.test(r)) return 'SPAM_COMPLAINT';
    if (/rate.?limit|too many|429|throttl/.test(r)) return 'RATE_LIMITED';
    if (/invalid.*(e-?mail|address)|not a valid email/.test(r)) return 'INVALID_EMAIL';
    if (/invalid.*(phone|number)/.test(r)) return 'INVALID_PHONE';
    if (/timeout|timed out|etimedout/.test(r)) return 'NETWORK_TIMEOUT';
    if (/auth|unauthor|forbidden|401|403/.test(r)) return 'AUTH_FAILED';
    if (/suppress/.test(r)) return 'BLOCKED_BY_SUPPRESSION';
    if (/opted out|preference|opt-out/.test(r)) return 'BLOCKED_BY_PREFERENCE';
    if (/not configured|unconfigured|missing.*(key|credential|dlt)/.test(r)) return 'NOT_CONFIGURED';
    if (r) return 'PROVIDER_ERROR';
    return 'UNKNOWN';
  }

  /**
   * Phase 185 (#5) — flip a SENT row to DELIVERED on a carrier
   * delivery-receipt. Idempotent: only advances rows currently SENT for
   * the given provider message id (a late/duplicate DLR is a no-op).
   * Returns the number of rows updated.
   */
  async markDelivered(providerMessageId: string, deliveredAt: Date): Promise<number> {
    const res = await this.prisma.notificationLog.updateMany({
      where: { providerMessageId, status: 'SENT' },
      data: { status: 'DELIVERED', deliveredAt },
    });
    return res.count;
  }

  /**
   * Phase 185 (#5) — record a CANCELLED row when an admin discards a
   * dead-lettered job before it is (re)delivered. This is the spec's
   * "admin-cancelled before send" terminal state: the job will not be
   * retried, and the cancellation is visible in the notification log with
   * its reason + original provenance.
   */
  async recordCancellation(job: NotificationJob, reason: string): Promise<NotificationLog> {
    return this.prisma.notificationLog.create({
      data: {
        channel: job.channel,
        status: 'CANCELLED',
        recipientId: job.recipientId ?? null,
        destination: job.destination ?? '(unresolved)',
        templateKey: job.templateKey ?? null,
        subject: job.subject ?? null,
        body: job.body,
        eventType: job.eventType ?? null,
        eventId: job.eventId ?? null,
        triggerSource: job.triggerSource ?? null,
        failureReason: reason,
        attemptNumber: job.attemptNumber,
      },
    });
  }

  async listForRecipient(args: {
    recipientId: string;
    page: number;
    limit: number;
  }) {
    const { recipientId, page, limit } = args;
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where: { recipientId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notificationLog.count({ where: { recipientId } }),
    ]);
    return { items, total, page, limit };
  }

  /** Admin-side log query with filters used by the ops console. */
  async listForAdmin(args: {
    page: number;
    limit: number;
    channel?: NotificationChannel;
    status?: NotificationStatus;
    recipientId?: string;
    eventType?: string;
    search?: string;
    fromDate?: Date;
    toDate?: Date;
  }) {
    const where: Prisma.NotificationLogWhereInput = {};
    if (args.channel) where.channel = args.channel;
    if (args.status) where.status = args.status;
    if (args.recipientId) where.recipientId = args.recipientId;
    if (args.eventType) where.eventType = args.eventType;
    if (args.search?.trim()) {
      const q = args.search.trim();
      where.OR = [
        { destination: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
        { templateKey: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (args.fromDate || args.toDate) {
      where.createdAt = {};
      if (args.fromDate) where.createdAt.gte = args.fromDate;
      if (args.toDate) where.createdAt.lte = args.toDate;
    }
    const skip = (args.page - 1) * args.limit;
    const [items, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: args.limit,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);
    return { items, total, page: args.page, limit: args.limit };
  }

  findById(id: string): Promise<NotificationLog | null> {
    return this.prisma.notificationLog.findUnique({ where: { id } });
  }
}
