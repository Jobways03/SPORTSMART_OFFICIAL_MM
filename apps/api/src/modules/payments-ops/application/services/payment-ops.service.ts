import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PaymentAttemptKind,
  PaymentAttemptStatus,
  PaymentMismatchKind,
  PaymentMismatchSource,
  PaymentMismatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

// Phase 169 (#10) — bound the admin-readable description so a webhook/upstream
// caller can't stuff an unbounded payload (and so any non-React renderer has a
// predictable max). Control chars (other than tab/newline) are stripped.
const MAX_DESCRIPTION_LEN = 2000;

/**
 * Coerce a paise value (number | bigint | string | null) into a
 * BigInt suitable for Prisma persistence, without going through
 * Number() — which would silently lose precision on values larger
 * than Number.MAX_SAFE_INTEGER (≈ 9 lakh rupees in paise).
 */
function coercePaise(
  v: number | bigint | string | null | undefined,
): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new RangeError(
        `Paise value must be an integer (got ${v}). Convert rupees to paise upstream.`,
      );
    }
    return BigInt(v);
  }
  if (typeof v === 'string') {
    if (!/^-?\d+$/.test(v.trim())) {
      throw new RangeError(`Paise string must be a plain integer (got "${v}")`);
    }
    return BigInt(v.trim());
  }
  throw new TypeError(`Unsupported paise type: ${typeof v}`);
}

/**
 * Records every gateway interaction + surfaces mismatches between what
 * we expected to receive vs what the gateway actually settled.
 */
@Injectable()
export class PaymentOpsService {
  private readonly logger = new Logger(PaymentOpsService.name);
  // Phase 169 (#12) — 60s in-memory metrics cache keyed by `days`. The raw
  // aggregate re-runs on every alerts-list refresh; this collapses the repeat
  // scans within a triage session to one query per window per minute.
  private metricsCache = new Map<number, { at: number; data: any }>();
  private static readonly METRICS_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    // @Optional so existing specs that construct the service with just prisma
    // keep working (AuditModule is @Global in the running app).
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {}

  // ── Attempt logging (called by checkout/refund services) ─────────

  async recordAttempt(args: {
    masterOrderId?: string | null;
    orderNumber?: string | null;
    kind: PaymentAttemptKind;
    status: PaymentAttemptStatus;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    providerRefundId?: string | null;
    // Phase 165 (#11/#12) — bigint accepted; coerced precision-safe below.
    amountInPaise?: number | bigint | null;
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
        amountInPaise: coercePaise(args.amountInPaise),
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
    expectedInPaise?: number | bigint | string | null;
    actualInPaise?: number | bigint | string | null;
    description: string;
    severity?: number;
    // Phase 169 (#13) — provenance + structured context.
    sourceType?: PaymentMismatchSource;
    sourceContext?: Prisma.InputJsonValue | null;
    provider?: string;
  }) {
    // Phase 2 (PR 2.3) — columns are BigInt; widened the facade signature
    // 2026-05-16 to accept number | bigint | string so callers can pass
    // raw BigInt values (settlement totals, large refunds) without
    // first round-tripping through Number() and losing precision on
    // values > Number.MAX_SAFE_INTEGER (≈ ₹9 lakh in paise). The
    // coercion to BigInt happens at this single persistence boundary.
    const expected = coercePaise(args.expectedInPaise);
    const actual = coercePaise(args.actualInPaise);
    const alert = await this.prisma.paymentMismatchAlert.create({
      data: {
        kind: args.kind,
        masterOrderId: args.masterOrderId ?? null,
        orderNumber: args.orderNumber ?? null,
        providerPaymentId: args.providerPaymentId ?? null,
        expectedInPaise: expected,
        actualInPaise: actual,
        // Phase 169 (#10) — bound + scrub the admin-readable description.
        description: this.sanitizeDescription(args.description),
        severity: this.clampSeverity(args.severity),
        provider: args.provider ?? 'razorpay',
        sourceType: args.sourceType ?? 'SYSTEM',
        sourceContext: args.sourceContext ?? Prisma.JsonNull,
      },
    });
    this.logger.warn(
      `Payment mismatch ${args.kind} created — order=${args.orderNumber ?? 'n/a'} payment=${args.providerPaymentId ?? 'n/a'} source=${args.sourceType ?? 'SYSTEM'}`,
    );
    return alert;
  }

  // Phase 169 (#10) — cap length + strip control chars (keep tab/newline). Not
  // an HTML encoder (React encodes on render); this is the upstream-write guard
  // + a predictable bound for any non-React renderer (PDF/email/CSV).
  private sanitizeDescription(raw: string): string {
    const trimmed = (raw ?? '').slice(0, MAX_DESCRIPTION_LEN);
    // eslint-disable-next-line no-control-regex
    return trimmed.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  }

  private clampSeverity(s?: number): number {
    if (s == null || !Number.isFinite(s)) return 50;
    return Math.max(0, Math.min(100, Math.round(s)));
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
    // Phase 169 (#11) — triage critical alerts without scrolling.
    minSeverity?: number;
  }) {
    const skip = (filter.page - 1) * filter.limit;
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.minSeverity != null && Number.isFinite(filter.minSeverity)) {
      where.severity = { gte: Math.max(0, Math.min(100, Math.round(filter.minSeverity))) };
    }
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
    // Phase 169 (#12) — serve from the 60s cache when warm.
    const cached = this.metricsCache.get(safe);
    if (cached && Date.now() - cached.at < PaymentOpsService.METRICS_TTL_MS) {
      return cached.data;
    }
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

    const data = {
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
    this.metricsCache.set(safe, { at: Date.now(), data });
    return data;
  }

  /**
   * Phase 169 (#3) — the failed-payments dashboard surface. Pre-169 failed
   * PaymentAttempt rows were only reachable by drill-down on a known order;
   * this lists them directly (the gateway-failure kinds, newest first).
   */
  async listFailedPayments(filter: {
    page: number;
    limit: number;
    search?: string;
    fromDate?: Date;
    toDate?: Date;
  }) {
    const skip = (filter.page - 1) * filter.limit;
    const where: any = {
      status: 'FAILURE',
      kind: { in: ['CREATE_ORDER', 'CAPTURE', 'VERIFY_SIGNATURE'] },
    };
    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { providerPaymentId: { contains: q, mode: 'insensitive' } },
        { providerOrderId: { contains: q, mode: 'insensitive' } },
        { failureReason: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (filter.fromDate || filter.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = filter.fromDate;
      if (filter.toDate) where.createdAt.lte = filter.toDate;
    }
    const [items, total] = await Promise.all([
      this.prisma.paymentAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: filter.limit,
      }),
      this.prisma.paymentAttempt.count({ where }),
    ]);
    return { items, total, page: filter.page, limit: filter.limit };
  }

  /**
   * Phase 169 (#5) — CAS transition. Pre-169 this was findUnique-then-update
   * (last-write-wins): two admins clicking RESOLVE both passed and the second
   * silently overwrote the first's resolvedByAdminId. The updateMany guards on
   * the expected fromStatus so exactly one caller wins; the loser re-reads and
   * reports the row's current state instead of clobbering it.
   * Also writes an AuditPublicFacade row (#audit-gap).
   */
  async transitionAlert(args: {
    id: string;
    status: PaymentMismatchStatus;
    notes?: string | null;
    adminId?: string;
    expectedFromStatus?: PaymentMismatchStatus;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const alert = await this.prisma.paymentMismatchAlert.findUnique({
      where: { id: args.id },
    });
    if (!alert) throw new NotFoundAppException('Alert not found');

    // Phase 169 review (L2#1) — reject a no-op self-transition so the audit
    // trail isn't polluted with "transitions" that changed nothing (a misclick
    // or a stale UI re-submit). Notes-only edits should use a dedicated path.
    if (alert.status === args.status) {
      throw new BadRequestAppException(
        `Alert is already ${args.status}; no transition to apply.`,
        'ALERT_NO_OP_TRANSITION',
      );
    }

    const terminal = args.status === 'RESOLVED' || args.status === 'IGNORED';
    // The CAS guard: by default we require the row to still be in the status the
    // caller last saw (passed from the controller), else the exact current
    // status if not supplied (degrades to a same-status no-clobber check).
    const fromStatus = args.expectedFromStatus ?? alert.status;
    const res = await this.prisma.paymentMismatchAlert.updateMany({
      where: { id: args.id, status: fromStatus },
      data: {
        status: args.status,
        resolutionNotes: args.notes ?? alert.resolutionNotes,
        resolvedByAdminId: terminal ? args.adminId ?? null : alert.resolvedByAdminId,
        resolvedAt: terminal ? new Date() : null,
      },
    });
    if (res.count === 0) {
      const latest = await this.prisma.paymentMismatchAlert.findUnique({
        where: { id: args.id },
      });
      throw new BadRequestAppException(
        `Alert was concurrently modified (now ${latest?.status ?? 'unknown'}). Refresh and retry.`,
        'ALERT_CONCURRENT_MODIFICATION',
      );
    }

    await this.audit
      ?.writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: 'PAYMENT_MISMATCH_TRANSITION',
        module: 'payments-ops',
        resource: 'PaymentMismatchAlert',
        resourceId: args.id,
        oldValue: { status: alert.status },
        newValue: { status: args.status },
        metadata: { kind: alert.kind, severity: alert.severity, notes: args.notes ?? null },
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      })
      .catch(() => undefined);

    return this.prisma.paymentMismatchAlert.findUnique({ where: { id: args.id } });
  }

  /**
   * Phase 169 (#16) — bulk transition. Each row is CAS-guarded + audited
   * individually (per the audit's "audit-log per row" requirement); returns a
   * per-id outcome so the UI can show partial success.
   */
  async bulkTransition(args: {
    ids: string[];
    status: PaymentMismatchStatus;
    notes?: string | null;
    adminId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ updated: number; skipped: number; results: Array<{ id: string; ok: boolean; reason?: string }> }> {
    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
    let updated = 0;
    let skipped = 0;
    for (const id of args.ids) {
      try {
        await this.transitionAlert({
          id,
          status: args.status,
          notes: args.notes,
          adminId: args.adminId,
          ipAddress: args.ipAddress,
          userAgent: args.userAgent,
        });
        results.push({ id, ok: true });
        updated++;
      } catch (err) {
        results.push({ id, ok: false, reason: (err as Error)?.message ?? 'failed' });
        skipped++;
      }
    }
    return { updated, skipped, results };
  }
}
