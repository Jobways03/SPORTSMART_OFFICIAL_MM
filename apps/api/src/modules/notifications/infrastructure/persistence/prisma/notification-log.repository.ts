import { Injectable } from '@nestjs/common';
import type {
  NotificationChannel,
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
    finalStatus: 'SENT' | 'FAILED' | 'RETRY';
  }): Promise<NotificationLog> {
    const { job, destination, result, finalStatus } = args;
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
        providerMessageId: result.providerMessageId ?? null,
        failureReason: result.failureReason ?? null,
        attemptNumber: job.attemptNumber,
        sentAt: finalStatus === 'SENT' ? new Date() : null,
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
