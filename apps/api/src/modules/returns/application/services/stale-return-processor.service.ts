import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { isTransitionAllowed } from '../../../../core/fsm/status-transitions';

/**
 * Background processor that handles returns stuck in intermediate states.
 *
 * | Stuck status          | Action                                         |
 * |-----------------------|------------------------------------------------|
 * | REQUESTED             | Auto-cancel (customer never followed up)        |
 * | APPROVED              | Auto-cancel (pickup never happened)             |
 * | PICKUP_SCHEDULED      | Escalate to admin (courier issue likely)        |
 * | IN_TRANSIT            | Escalate to admin (lost in transit?)            |
 * | RECEIVED              | Escalate to admin (QC never done)               |
 * | REFUND_PROCESSING     | Leave for RefundProcessor; only escalate if     |
 * |                       | attempts exhausted (>= 5) and stale             |
 * | QC_REJECTED           | Auto-close (nothing to refund)                  |
 * | REFUNDED              | Auto-close (just needs formal completion)       |
 *
 * "Escalate" = publish an event that the admin notification handler catches.
 * "Auto-close" = move to COMPLETED status.
 * "Auto-cancel" = move to CANCELLED status.
 *
 * Phase 214 (#7) — migrated from the legacy `OnModuleInit` + `setInterval`
 * + unfenced `redis.acquireLock/releaseLock` loop (the last returns cron
 * still on that pattern, with no observability) to the canonical cron shape
 * used everywhere else in this module (see seller-response-sweeper.cron.ts /
 * refund-status-poller.cron.ts):
 *
 *   • `@Cron(EVERY_HOUR)` — equivalent cadence to the old default
 *     RETURN_STALE_CHECK_INTERVAL_MINUTES=60; flag-gated on
 *     RETURN_STALE_DAYS (<= 0 disables, unchanged contract).
 *   • `LeaderElectedCron.run(...)` — fenced (Lua-CAS) cluster lock so N
 *     replicas don't all scan the same rows; replaces the raw lock pair
 *     whose TTL-expiry race could let two replicas run concurrently.
 *   • `CronInstrumentationService.wrap(...)` — one cron_runs row + Prom
 *     metrics per tick (counts surfaced in the `result` JSON).
 *   • Best-effort `AuditPublicFacade` summary row per tick (one row, OUTSIDE
 *     the per-row transactions, so an audit blip never aborts the sweep).
 *   • Each per-row status flip + status_history breadcrumb now commits in a
 *     single `$transaction` so a crash between them can't leave a CANCELLED /
 *     COMPLETED row with no history line.
 */
@Injectable()
export class StaleReturnProcessorService {
  private readonly logger = new Logger(StaleReturnProcessorService.name);
  private readonly staleDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly instrumentation: CronInstrumentationService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.staleDays = this.envService.getNumber('RETURN_STALE_DAYS', 30);
  }

  /**
   * Disabled when RETURN_STALE_DAYS <= 0 (preserves the old onModuleInit
   * contract — setting it to 0 turned the processor off without a code
   * change). The @Cron decorator still registers on every replica, but a
   * disabled tick returns immediately before acquiring the leader lock.
   */
  enabled(): boolean {
    return this.staleDays > 0;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.enabled()) {
      this.logger.debug(
        'Stale-return processor disabled (RETURN_STALE_DAYS <= 0); tick skipped',
      );
      return;
    }
    // ttl = 2 * tick interval (1h) per LeaderElectedCron's rule of thumb.
    await this.leader.run('return-stale-processor', 2 * 60 * 60, async () => {
      await this.instrumentation.wrap('returns.stale_processor', async () => {
        return this.tick();
      });
    });
  }

  /**
   * One sweep. Returns the per-tick counts so CronInstrumentation captures
   * them in the cron_runs `result` JSON and the audit summary row mirrors
   * them. Public so it stays manually tick-able from tests.
   */
  async tick(): Promise<{
    cancelled: number;
    closed: number;
    escalated: number;
    exhausted: number;
  }> {
    const cutoff = new Date(Date.now() - this.staleDays * 24 * 60 * 60 * 1000);

    // ── Auto-cancel: REQUESTED / APPROVED that went nowhere ──
    const cancelled = await this.autoCancelStale(cutoff, [
      'REQUESTED',
      'APPROVED',
    ]);

    // ── Auto-close: REFUNDED / QC_REJECTED that were never formally closed ──
    const closed = await this.autoCloseStale(cutoff, ['REFUNDED', 'QC_REJECTED']);

    // ── Escalate: intermediate states that need human attention ──
    const escalated = await this.escalateStale(cutoff, [
      'PICKUP_SCHEDULED',
      'IN_TRANSIT',
      'RECEIVED',
    ]);

    // ── Escalate exhausted refund retries ──
    const exhausted = await this.escalateExhaustedRefunds(cutoff);

    const counts = { cancelled, closed, escalated, exhausted };

    // Phase 214 (#7) — one best-effort summary audit row per tick. Written
    // OUTSIDE every per-row transaction so a logging failure can never abort
    // (or roll back) the sweep. We only bother when something actually moved.
    if (cancelled + closed + escalated + exhausted > 0) {
      this.audit
        .writeAuditLog({
          actorType: 'SYSTEM',
          actorRole: 'SYSTEM',
          action: 'RETURN_STALE_PROCESSED',
          module: 'returns',
          resource: 'return',
          resourceId: 'stale-return-processor',
          metadata: { ...counts, staleDays: this.staleDays },
        })
        .catch((err) =>
          this.logger.warn(
            `[stale-return-processor] summary audit write failed: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          ),
        );
    }

    return counts;
  }

  /** Env-tunable per-status batch caps (default 50; exhausted-refund default 20). */
  private batchSize(): number {
    return this.envService.getNumber('RETURN_STALE_BATCH_SIZE' as any, 50);
  }

  private exhaustedBatchSize(): number {
    return this.envService.getNumber(
      'RETURN_STALE_EXHAUSTED_BATCH_SIZE' as any,
      20,
    );
  }

  private async autoCancelStale(
    cutoff: Date,
    statuses: string[],
  ): Promise<number> {
    const stale = await this.prisma.return.findMany({
      where: {
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, returnNumber: true, status: true },
      take: this.batchSize(),
    });

    let cancelled = 0;
    for (const ret of stale) {
      try {
        // Phase 0 (PR 0.8) — guard the transition + CAS on status so a
        // concurrent customer-cancel / admin-reject doesn't get clobbered.
        // `updateMany` returns count=0 when the WHERE clause matched no
        // rows (status moved underneath us); we skip the history write
        // in that case so the audit trail stays honest.
        if (!isTransitionAllowed('ReturnStatus', ret.status, 'CANCELLED')) {
          this.logger.warn(
            `Skipping ${ret.returnNumber}: ${ret.status} → CANCELLED is not in the FSM matrix`,
          );
          continue;
        }
        // Phase 214 (#7) — the CAS flip + history breadcrumb commit
        // atomically. Pre-214 a crash between them could leave a CANCELLED
        // row with no history line (or vice versa). The transaction returns
        // the claim count so we only count rows we actually moved.
        const moved = await this.prisma.$transaction(async (tx) => {
          const result = await tx.return.updateMany({
            where: { id: ret.id, status: ret.status as any },
            data: { status: 'CANCELLED', closedAt: new Date() },
          });
          if (result.count === 0) return false;
          await tx.returnStatusHistory.create({
            data: {
              returnId: ret.id,
              fromStatus: ret.status,
              toStatus: 'CANCELLED',
              changedBy: 'SYSTEM',
              changedById: 'stale-return-processor',
              notes: `Auto-cancelled — stale in ${ret.status} for ${this.staleDays}+ days`,
            },
          });
          return true;
        });
        if (!moved) {
          this.logger.log(
            `Skipped auto-cancel for ${ret.returnNumber}: status changed under us (was ${ret.status})`,
          );
          continue;
        }
        cancelled++;
        this.logger.log(
          `Auto-cancelled stale return ${ret.returnNumber} (was ${ret.status})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-cancel ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
    return cancelled;
  }

  private async autoCloseStale(
    cutoff: Date,
    statuses: string[],
  ): Promise<number> {
    const stale = await this.prisma.return.findMany({
      where: {
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, returnNumber: true, status: true },
      take: this.batchSize(),
    });

    let closed = 0;
    for (const ret of stale) {
      try {
        // Phase 0 (PR 0.8) — same CAS-on-status pattern as autoCancelStale.
        if (!isTransitionAllowed('ReturnStatus', ret.status, 'COMPLETED')) {
          this.logger.warn(
            `Skipping ${ret.returnNumber}: ${ret.status} → COMPLETED is not in the FSM matrix`,
          );
          continue;
        }
        // Phase 105 (2026-05-23) — Phase 104 audit Gap #14 closure.
        // Pre-Phase-105 the auto-close path wrote `{ status, closedAt }`
        // only — the closeReason / closedBy / closedByActorType fields
        // added in Phase 101 stayed null for cron-closed rows. We now
        // stamp the SYSTEM actor + a structured reason so finance
        // dashboards see the same shape regardless of the close path,
        // AND we publish the same `returns.return.closed` event so
        // downstream handlers (BulkJob trace, customer notification
        // when added) fire for stale-closed rows too.
        const now = new Date();
        const closeReason = `Auto-closed — stale in ${ret.status} for ${this.staleDays}+ days`;
        // Phase 214 (#7) — CAS flip + history breadcrumb in one transaction.
        const moved = await this.prisma.$transaction(async (tx) => {
          const result = await tx.return.updateMany({
            where: { id: ret.id, status: ret.status as any },
            data: {
              status: 'COMPLETED' as any,
              closedAt: now,
              closedBy: 'stale-return-processor',
              closedByActorType: 'SYSTEM',
              closeReason,
            } as any,
          });
          if (result.count === 0) return false;
          await tx.returnStatusHistory.create({
            data: {
              returnId: ret.id,
              fromStatus: ret.status,
              toStatus: 'COMPLETED',
              changedBy: 'SYSTEM',
              changedById: 'stale-return-processor',
              notes: closeReason,
            },
          });
          return true;
        });
        if (!moved) {
          this.logger.log(
            `Skipped auto-close for ${ret.returnNumber}: status changed under us (was ${ret.status})`,
          );
          continue;
        }
        closed++;
        // Publish the same event the service path emits so any
        // downstream subscribers (customer notification, metrics)
        // see stale-closed returns too. Best-effort + OUTSIDE the tx —
        // a publish failure must not roll back the close.
        try {
          await this.eventBus.publish({
            eventName: 'returns.return.closed',
            aggregate: 'Return',
            aggregateId: ret.id,
            occurredAt: now,
            payload: {
              returnId: ret.id,
              returnNumber: ret.returnNumber,
              closedBy: 'stale-return-processor',
              closedByActorType: 'SYSTEM',
              closeReason,
              fromStatus: ret.status,
              source: 'STALE_CRON',
            },
          });
        } catch (err) {
          this.logger.warn(
            `[stale-auto-close] event publish failed for ${ret.returnNumber}: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          );
        }
        this.logger.log(
          `Auto-closed stale return ${ret.returnNumber} (was ${ret.status})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-close ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
    return closed;
  }

  private async escalateStale(
    cutoff: Date,
    statuses: string[],
  ): Promise<number> {
    const stale = await this.prisma.return.findMany({
      where: {
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        masterOrderId: true,
        customerId: true,
      },
      take: this.batchSize(),
    });

    let escalated = 0;
    for (const ret of stale) {
      try {
        this.eventBus
          .publish({
            eventName: 'returns.return.stale_escalation',
            aggregate: 'Return',
            aggregateId: ret.id,
            occurredAt: new Date(),
            payload: {
              returnId: ret.id,
              returnNumber: ret.returnNumber,
              currentStatus: ret.status,
              masterOrderId: ret.masterOrderId,
              staleDays: this.staleDays,
            },
          })
          .catch(() => {});
        escalated++;
        this.logger.warn(
          `Escalated stale return ${ret.returnNumber} (${ret.status} for ${this.staleDays}+ days)`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to escalate ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
    return escalated;
  }

  private async escalateExhaustedRefunds(cutoff: Date): Promise<number> {
    const exhausted = await this.prisma.return.findMany({
      where: {
        status: 'REFUND_PROCESSING',
        refundAttempts: { gte: 5 },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        returnNumber: true,
        refundAmount: true,
        refundAttempts: true,
        refundFailureReason: true,
      },
      take: this.exhaustedBatchSize(),
    });

    let count = 0;
    for (const ret of exhausted) {
      try {
        this.eventBus
          .publish({
            eventName: 'returns.refund.exhausted_escalation',
            aggregate: 'Return',
            aggregateId: ret.id,
            occurredAt: new Date(),
            payload: {
              returnId: ret.id,
              returnNumber: ret.returnNumber,
              refundAmount: Number(ret.refundAmount),
              attempts: ret.refundAttempts,
              lastFailureReason: ret.refundFailureReason,
            },
          })
          .catch(() => {});
        count++;
        this.logger.warn(
          `Escalated exhausted refund for ${ret.returnNumber} (${ret.refundAttempts} attempts, last: ${ret.refundFailureReason})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to escalate exhausted refund ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }
}
