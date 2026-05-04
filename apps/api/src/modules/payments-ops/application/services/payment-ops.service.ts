import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PaymentAttemptKind,
  PaymentAttemptStatus,
  PaymentMismatchKind,
  PaymentMismatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

/**
 * Records every gateway interaction + surfaces mismatches between what
 * we expected to receive vs what the gateway actually settled.
 */
@Injectable()
export class PaymentOpsService {
  private readonly logger = new Logger(PaymentOpsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Attempt logging (called by checkout/refund services) ─────────

  async recordAttempt(args: {
    masterOrderId?: string | null;
    orderNumber?: string | null;
    kind: PaymentAttemptKind;
    status: PaymentAttemptStatus;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    providerRefundId?: string | null;
    amountInPaise?: number | null;
    currency?: string;
    responseSummary?: string | null;
    failureReason?: string | null;
  }) {
    const attemptNumber = args.masterOrderId
      ? (await this.prisma.paymentAttempt.count({
          where: { masterOrderId: args.masterOrderId, kind: args.kind },
        })) + 1
      : 1;

    return this.prisma.paymentAttempt.create({
      data: {
        masterOrderId: args.masterOrderId ?? null,
        orderNumber: args.orderNumber ?? null,
        kind: args.kind,
        status: args.status,
        providerOrderId: args.providerOrderId ?? null,
        providerPaymentId: args.providerPaymentId ?? null,
        providerRefundId: args.providerRefundId ?? null,
        amountInPaise: args.amountInPaise ?? null,
        currency: args.currency ?? 'INR',
        responseSummary: args.responseSummary ?? null,
        failureReason: args.failureReason ?? null,
        attemptNumber,
      },
    });
  }

  // ── Mismatch alerts ─────────────────────────────────────────────

  async createMismatchAlert(args: {
    kind: PaymentMismatchKind;
    masterOrderId?: string | null;
    orderNumber?: string | null;
    providerPaymentId?: string | null;
    expectedInPaise?: number | null;
    actualInPaise?: number | null;
    description: string;
    severity?: number;
  }) {
    const alert = await this.prisma.paymentMismatchAlert.create({
      data: {
        kind: args.kind,
        masterOrderId: args.masterOrderId ?? null,
        orderNumber: args.orderNumber ?? null,
        providerPaymentId: args.providerPaymentId ?? null,
        expectedInPaise: args.expectedInPaise ?? null,
        actualInPaise: args.actualInPaise ?? null,
        description: args.description,
        severity: args.severity ?? 50,
      },
    });
    this.logger.warn(
      `Payment mismatch ${args.kind} created — order=${args.orderNumber ?? 'n/a'} payment=${args.providerPaymentId ?? 'n/a'}`,
    );
    return alert;
  }

  listAttemptsForOrder(masterOrderId: string) {
    return this.prisma.paymentAttempt.findMany({
      where: { masterOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAlerts(filter: {
    page: number;
    limit: number;
    status?: PaymentMismatchStatus;
    kind?: PaymentMismatchKind;
    search?: string;
    fromDate?: Date;
    toDate?: Date;
  }) {
    const skip = (filter.page - 1) * filter.limit;
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { providerPaymentId: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (filter.fromDate || filter.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = filter.fromDate;
      if (filter.toDate) where.createdAt.lte = filter.toDate;
    }
    const [items, total] = await Promise.all([
      this.prisma.paymentMismatchAlert.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: filter.limit,
      }),
      this.prisma.paymentMismatchAlert.count({ where }),
    ]);
    return { items, total, page: filter.page, limit: filter.limit };
  }

  async getAlert(id: string) {
    const alert = await this.prisma.paymentMismatchAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundAppException('Alert not found');
    const attempts = alert.masterOrderId
      ? await this.listAttemptsForOrder(alert.masterOrderId)
      : [];
    return { alert, attempts };
  }

  /**
   * Per-day attempt + alert summary for the last `days` days. Used by
   * the admin dashboard to spot trends (e.g. signature failure spikes).
   */
  async getMetrics(days = 7) {
    const safe = Math.max(1, Math.min(days, 90));
    const since = new Date(Date.now() - safe * 24 * 60 * 60 * 1000);

    const attemptRows = await this.prisma.$queryRaw<Array<{
      day: string;
      kind: PaymentAttemptKind;
      status: PaymentAttemptStatus;
      n: bigint;
    }>>(Prisma.sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             kind, status, COUNT(*)::bigint AS n
      FROM payment_attempts
      WHERE created_at >= ${since}
      GROUP BY 1, 2, 3
      ORDER BY 1
    `);

    const alertRows = await this.prisma.$queryRaw<Array<{
      day: string;
      kind: PaymentMismatchKind;
      n: bigint;
    }>>(Prisma.sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             kind, COUNT(*)::bigint AS n
      FROM payment_mismatch_alerts
      WHERE created_at >= ${since}
      GROUP BY 1, 2
      ORDER BY 1
    `);

    return {
      since: since.toISOString(),
      attempts: attemptRows.map((r) => ({
        day: r.day,
        kind: r.kind,
        status: r.status,
        count: Number(r.n),
      })),
      alerts: alertRows.map((r) => ({
        day: r.day,
        kind: r.kind,
        count: Number(r.n),
      })),
    };
  }

  async transitionAlert(args: {
    id: string;
    status: PaymentMismatchStatus;
    notes?: string | null;
    adminId?: string;
  }) {
    const alert = await this.prisma.paymentMismatchAlert.findUnique({
      where: { id: args.id },
    });
    if (!alert) throw new NotFoundAppException('Alert not found');
    return this.prisma.paymentMismatchAlert.update({
      where: { id: args.id },
      data: {
        status: args.status,
        resolutionNotes: args.notes ?? alert.resolutionNotes,
        resolvedByAdminId:
          args.status === 'RESOLVED' || args.status === 'IGNORED'
            ? args.adminId ?? null
            : alert.resolvedByAdminId,
        resolvedAt:
          args.status === 'RESOLVED' || args.status === 'IGNORED'
            ? new Date()
            : null,
      },
    });
  }
}
