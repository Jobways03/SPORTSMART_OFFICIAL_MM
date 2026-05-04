import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AccessActorType,
  AccessEventKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

export interface RecordAccessInput {
  actorType: AccessActorType;
  actorId: string;
  kind: AccessEventKind;
  ipAddress?: string | null;
  userAgent?: string | null;
  succeeded?: boolean;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  /**
   * Stable hash for "device" — combines UA + first three IP octets.
   * Avoids exact-IP fingerprinting while still detecting major changes
   * (different network, different browser).
   */
  static deviceHash(ua?: string | null, ip?: string | null): string {
    const ipPrefix = (ip ?? '').split('.').slice(0, 3).join('.');
    return createHash('sha256').update(`${ua ?? ''}|${ipPrefix}`).digest('hex').slice(0, 32);
  }

  async record(input: RecordAccessInput): Promise<void> {
    const deviceHash = AccessLogService.deviceHash(input.userAgent, input.ipAddress);

    await this.prisma.accessLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        kind: input.kind,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        deviceHash,
        succeeded: input.succeeded ?? true,
        reason: input.reason,
        metadata: input.metadata,
      },
    });

    // Lockout: 5+ LOGIN_FAILURE for the same CUSTOMER actor within 15
    // minutes locks the account for 30 minutes. Other actor types use
    // their own lockout fields if/when added; for now we only act on
    // CUSTOMER since the User table is the only one with lockUntil.
    if (input.kind === 'LOGIN_FAILURE' && input.actorType === 'CUSTOMER') {
      await this.maybeLockCustomer(input.actorId);
    }

    // New-device alert: only when LOGIN_SUCCESS comes from a device
    // hash this CUSTOMER hasn't used before. Email goes via the
    // notifications module.
    if (input.kind === 'LOGIN_SUCCESS' && input.actorType === 'CUSTOMER') {
      const seenBefore = await this.prisma.accessLog.count({
        where: {
          actorType: input.actorType,
          actorId: input.actorId,
          deviceHash,
          kind: 'LOGIN_SUCCESS',
          NOT: { id: undefined },
        },
      });
      if (seenBefore <= 1) {
        await this.flagNewDevice(input);
      }
    }
  }

  private async maybeLockCustomer(actorId: string): Promise<void> {
    // actorId for LOGIN_FAILURE is the email (not yet a real userId).
    // Resolve the user; if no match, skip — the failure is meaningful
    // for the spike detector but not for lockout.
    const user = await this.prisma.user.findUnique({
      where: { email: actorId },
      select: { id: true, failedLoginAttempts: true, lockUntil: true },
    });
    if (!user) return;

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentFails = await this.prisma.accessLog.count({
      where: {
        actorType: 'CUSTOMER',
        actorId, // email
        kind: 'LOGIN_FAILURE',
        createdAt: { gte: fifteenMinAgo },
      },
    });

    if (recentFails >= 5) {
      const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          lockUntil,
        },
      });
      this.logger.warn(
        `User ${user.id} locked until ${lockUntil.toISOString()} after ${recentFails} failed logins`,
      );
    } else {
      // Still increment counter for visibility, but don't lock yet.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    }
  }

  private async flagNewDevice(input: RecordAccessInput): Promise<void> {
    await this.prisma.accessLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        kind: 'NEW_DEVICE_DETECTED',
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        deviceHash: AccessLogService.deviceHash(input.userAgent, input.ipAddress),
        succeeded: true,
        metadata: input.metadata,
      },
    });

    try {
      await this.notifications.notifyFromTemplate({
        eventClass: 'security',
        templateKey: 'security.new_device_login',
        recipientId: input.actorId,
        vars: {
          customerName: '',
          loginTime: new Date().toLocaleString('en-IN'),
          ipAddress: input.ipAddress ?? 'unknown',
          userAgent: input.userAgent ?? 'unknown',
          accessHistoryUrl: '/account/access-history',
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to enqueue new-device notification: ${(e as Error).message}`);
    }
  }

  async listForActor(args: {
    actorType: AccessActorType;
    actorId: string;
    kind?: AccessEventKind;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }) {
    const limit = Math.min(args.limit ?? 50, 500);
    const where: Prisma.AccessLogWhereInput = {
      actorType: args.actorType,
      actorId: args.actorId,
    };
    if (args.kind) where.kind = args.kind;
    if (args.fromDate || args.toDate) {
      where.createdAt = {};
      if (args.fromDate) where.createdAt.gte = args.fromDate;
      if (args.toDate) where.createdAt.lte = args.toDate;
    }
    return this.prisma.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Failed-login spike summary. Returns actors with N+ LOGIN_FAILURE
   * rows in the last `hours` hours, sorted by failure count desc. Used
   * by the ops console to spot brute-force attempts before they escalate.
   */
  async failedLoginSpike(args: {
    minFailures?: number;
    hours?: number;
  }) {
    const hours = Math.max(1, Math.min(args.hours ?? 24, 24 * 7));
    const minFailures = Math.max(2, args.minFailures ?? 5);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await this.prisma.accessLog.groupBy({
      by: ['actorType', 'actorId', 'ipAddress'],
      where: {
        kind: 'LOGIN_FAILURE',
        createdAt: { gte: since },
      },
      _count: { _all: true },
      _max: { createdAt: true },
      having: { id: { _count: { gte: minFailures } } },
      orderBy: { _count: { id: 'desc' } },
      take: 100,
    });

    return {
      since: since.toISOString(),
      hours,
      minFailures,
      items: rows.map((r) => ({
        actorType: r.actorType,
        actorId: r.actorId,
        ipAddress: r.ipAddress,
        failureCount: r._count._all,
        lastFailureAt: r._max.createdAt,
      })),
    };
  }
}
