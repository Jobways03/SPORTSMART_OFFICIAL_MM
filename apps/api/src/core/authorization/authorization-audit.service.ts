import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuthorizationDecisionEffect,
  AuthorizationLayer,
} from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import {
  MetricsRegistry,
  CounterHandle,
} from '../metrics/metrics.registry';

export interface AuthorizationAuditEntry {
  layer: AuthorizationLayer;
  decision: AuthorizationDecisionEffect;
  wouldHaveBlocked: boolean;
  routeLabel: string;

  adminId?: string | null;
  actorRole?: string | null;
  actorRoles?: string[];

  method?: string;
  path?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;

  requiredPermissions?: string[];

  resourceType?: string | null;
  action?: string | null;
  matchedPolicyId?: string | null;
  matchedPolicyName?: string | null;
  context?: Record<string, unknown> | null;

  reason?: string | null;
}

/**
 * Phase 4 (PR 4.4) — Buffered authorization audit writer.
 *
 * Why buffered:
 *   - Permissions/Policy guards run on EVERY admin request. A
 *     synchronous DB INSERT per request adds ~3-5ms of P50 latency to
 *     every dashboard click.
 *   - Audit data is informational; losing the last few rows on hard
 *     crash is acceptable. Losing the last *minute* is not, so we
 *     flush on a 1s timer and on module shutdown.
 *
 * Two backstops keep the buffer from growing without bound:
 *   - HARD_BUFFER_LIMIT triggers an inline flush if the buffer crosses
 *     it (e.g. during a heavy export run). The flush still happens
 *     async — the calling guard's request isn't blocked — but a fresh
 *     scheduled flush kicks in immediately.
 *   - On flush failure we log and discard. Better to lose one batch
 *     than to wedge every guard on a slow DB.
 */
@Injectable()
export class AuthorizationAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthorizationAuditService.name);
  private buffer: Prisma.AuthorizationAuditCreateManyInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  // PR 4.6 — observability for the previously-silent failure path.
  // Flush failures used to log once and discard; in incident-review
  // we want to see the trend on the metrics endpoint, not chase a
  // grep of intermittent log lines. Lazy-initialised in onModuleInit
  // so the registry can register them at boot.
  private droppedCounter!: CounterHandle;
  private flushCounter!: CounterHandle;
  private flushFailureCounter!: CounterHandle;
  /** Running total of audit rows that have been dropped on flush failure. */
  private droppedTotal = 0;

  /** Flush every second when there are pending rows. */
  private static readonly FLUSH_INTERVAL_MS = 1_000;
  /** Inline-trigger a flush when the buffer crosses this size. */
  private static readonly HARD_BUFFER_LIMIT = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly metrics: MetricsRegistry,
  ) {}

  onModuleInit(): void {
    this.flushCounter = this.metrics.counter(
      'authz_audit_flush_total',
      'Number of authorization-audit flush attempts (successful + failed).',
    );
    this.flushFailureCounter = this.metrics.counter(
      'authz_audit_flush_failure_total',
      'Number of authorization-audit flush attempts that threw — rows in ' +
        'that batch were dropped (see authz_audit_dropped_rows_total).',
    );
    this.droppedCounter = this.metrics.counter(
      'authz_audit_dropped_rows_total',
      'Cumulative count of authorization-audit rows dropped because the ' +
        'flush errored. Non-zero means compliance is losing decisions; ' +
        'investigate DB health or the authorization_audits table.',
    );
  }

  /** Test/inspection: how many rows have been dropped so far. */
  getDroppedRowCount(): number {
    return this.droppedTotal;
  }

  record(entry: AuthorizationAuditEntry): void {
    if (!this.env.getBoolean('AUTHZ_AUDIT_ENABLED', true)) return;

    this.buffer.push({
      layer: entry.layer,
      decision: entry.decision,
      wouldHaveBlocked: entry.wouldHaveBlocked,
      routeLabel: entry.routeLabel,
      adminId: entry.adminId ?? null,
      actorRole: entry.actorRole ?? null,
      actorRoles: entry.actorRoles ?? [],
      method: entry.method ?? null,
      path: entry.path ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
      requiredPermissions: entry.requiredPermissions ?? [],
      resourceType: entry.resourceType ?? null,
      action: entry.action ?? null,
      matchedPolicyId: entry.matchedPolicyId ?? null,
      matchedPolicyName: entry.matchedPolicyName ?? null,
      context:
        entry.context == null
          ? Prisma.JsonNull
          : (entry.context as Prisma.InputJsonValue),
      reason: entry.reason ?? null,
    });

    if (this.buffer.length >= AuthorizationAuditService.HARD_BUFFER_LIMIT) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Flushes any pending rows. Safe to await externally (tests). */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.buffer.length === 0) {
      this.cancelTimer();
      return;
    }
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];
    this.cancelTimer();

    this.flushCounter?.inc();

    try {
      // skipDuplicates is a defensive no-op here (no UNIQUE constraint),
      // but it ensures bulk insert doesn't blow up on weird race edges.
      await this.prisma.authorizationAudit.createMany({
        data: batch,
        skipDuplicates: true,
      });
    } catch (err) {
      // Don't let an audit-table outage take down the app. Log and drop.
      // But surface the drop loudly: structured JSON line + a metrics
      // counter the /metrics endpoint exposes. Compliance and incident
      // response will notice the counter ticking up where they used to
      // see only the original warning text.
      this.flushFailureCounter?.inc();
      this.droppedTotal += batch.length;
      this.droppedCounter?.inc({}, batch.length);
      this.logger.error(
        JSON.stringify({
          event: 'authz.audit.flush_failed',
          droppedRows: batch.length,
          droppedTotal: this.droppedTotal,
          error: (err as Error).message,
        }),
      );
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, AuthorizationAuditService.FLUSH_INTERVAL_MS);
    // Don't keep the event loop alive for an audit flush during shutdown.
    this.flushTimer.unref?.();
  }

  private cancelTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
