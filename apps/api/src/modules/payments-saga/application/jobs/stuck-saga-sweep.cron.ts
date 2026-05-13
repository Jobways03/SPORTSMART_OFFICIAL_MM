import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { LedgerSourceType, RefundSourceType } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';

const BATCH_SIZE = 50;

/**
 * RefundSourceType ⊇ LedgerSourceType. RefundSourceType has an extra
 * `REPLACEMENT` value (price-difference settle-up on replacement orders)
 * which has no matching ledger source — collapse it to `MANUAL`.
 */
function refundTypeToLedgerSource(t: RefundSourceType): LedgerSourceType {
  switch (t) {
    case 'RETURN':
      return 'RETURN';
    case 'DISPUTE':
      return 'DISPUTE';
    case 'GOODWILL':
      return 'GOODWILL';
    case 'MANUAL':
    case 'REPLACEMENT':
      return 'MANUAL';
    default:
      return 'MANUAL';
  }
}

/**
 * Phase 1 (PR 1.5) — Stuck-saga sweep.
 *
 * The refund saga service (`RefundSagaService`) persists per-step
 * state on `refund_sagas.steps` so a crash mid-saga is recoverable.
 * The audit's CR-10 flagged the missing recovery loop: today a
 * crashed-mid-flight saga sits in `STARTED` / `IN_PROGRESS` forever,
 * the customer's wallet never gets credited, and ops has to find
 * the orphan row by hand.
 *
 * This cron closes that gap. Every 5 minutes:
 *   1. Find sagas whose `status` ∈ (STARTED, IN_PROGRESS) AND
 *      `startedAt < now() - STUCK_THRESHOLD_MS` AND `completedAt IS NULL`.
 *   2. CAS-flip the saga to FAILED with a `STUCK_AUTO_ESCALATED` reason.
 *      The `updateMany WHERE status IN (...)` is the load-bearing
 *      dedup against multi-replica races.
 *   3. Enqueue an `AdminTask` (REFUND_INSTRUCTION_FAILED, SLA 4h) so
 *      finance is paged within hours rather than discovering the
 *      orphan during the next reconciliation.
 *   4. Emit `payments.saga.stuck_auto_escalated` for downstream
 *      handlers (notifications, audit).
 *
 * Why FAIL-and-escalate rather than auto-resume from the last
 * SUCCEEDED step:
 *   - The forward step callbacks live in the caller (dispute service,
 *     return service). They're captured by closure and not persisted
 *     in `refund_sagas.steps` — only the step `name` is. Auto-resume
 *     would require a "step registry by name" mechanism that lives
 *     in a future PR.
 *   - A FAIL+escalate is reversible by humans (admin can re-run the
 *     refund through the existing approve / mark-paid flows). Silent
 *     auto-resumption of a saga with possibly-stale state is not.
 *
 * Multi-replica safety: wrapped in `LeaderElectedCron` (PR 1.1) AND
 * the per-row CAS makes the body itself idempotent even if leader
 * election fails.
 *
 * Env-flag: `REFUND_SAGA_SWEEP_ENABLED`. Defaults to true. Setting
 * false during an ops incident lets the team pause auto-escalation.
 */
@Injectable()
export class StuckSagaSweepCron {
  private readonly logger = new Logger(StuckSagaSweepCron.name);
  /**
   * A saga is considered "stuck" once its `startedAt` is older than
   * this. 5 minutes is a generous upper bound for the longest forward
   * step (Razorpay refund: median ~2s, p99 ~30s, hard timeout 30s).
   * Tunable via `REFUND_SAGA_STUCK_MINUTES`.
   */
  private static readonly DEFAULT_STUCK_MINUTES = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly ledger: LiabilityLedgerPublicFacade,
    // Phase 5 (PR 5.1) — cron-run observability. Every sweep lands a
    // row in `cron_runs` with duration + the `{ scanned, marked }`
    // result; failures land status=FAILED. The heartbeat detector
    // alerts when no row appears for > tolerance.
    private readonly instr: CronInstrumentationService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.env.getBoolean('REFUND_SAGA_SWEEP_ENABLED', true)) return;

    await this.leader.run('stuck-saga-sweep', 10 * 60, async () => {
      // Phase 5 (PR 5.1) — wrap so each sweep tick is auditable.
      // sweepOnce returns the per-tick metric shape. Errors propagate
      // through instr.wrap (records FAILED) and are swallowed at the
      // outer boundary so @nestjs/schedule doesn't double-log.
      try {
        await this.instr.wrap('stuck-saga-sweep', () => this.sweepOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async sweepOnce(): Promise<{ scanned: number; escalated: number }> {
    const stuckMinutes = this.env.getNumber(
      'REFUND_SAGA_STUCK_MINUTES',
      StuckSagaSweepCron.DEFAULT_STUCK_MINUTES,
    );
    const cutoff = new Date(Date.now() - stuckMinutes * 60 * 1000);

    const candidates = await this.prisma.refundSaga.findMany({
      where: {
        status: { in: ['STARTED', 'IN_PROGRESS'] },
        startedAt: { lt: cutoff },
        completedAt: null,
      },
      select: {
        id: true,
        refundType: true,
        sourceId: true,
        customerId: true,
        amountInPaise: true,
        startedAt: true,
        status: true,
      },
      take: BATCH_SIZE,
      orderBy: { startedAt: 'asc' },
    });

    if (candidates.length === 0) return { scanned: 0, escalated: 0 };
    this.logger.warn(
      `Found ${candidates.length} stuck refund saga(s) past ${stuckMinutes}m threshold`,
    );

    let escalated = 0;
    for (const saga of candidates) {
      // CAS-flip: only this replica's update succeeds; a concurrent
      // tick or leader-fallback gets count=0 and skips the side effects.
      const result = await this.prisma.refundSaga.updateMany({
        where: {
          id: saga.id,
          status: { in: ['STARTED', 'IN_PROGRESS'] },
          completedAt: null,
        },
        data: {
          status: 'FAILED',
          failureReason: `STUCK_AUTO_ESCALATED: no terminal state reached after ${stuckMinutes}m`,
          completedAt: new Date(),
        },
      });
      if (result.count === 0) {
        // Another writer (recovery, race) already flipped it. Skip
        // the side-effects so they don't double-fire.
        this.logger.log(
          `Saga ${saga.id} CAS lost (already moved) — skipping escalation`,
        );
        continue;
      }

      escalated++;
      this.logger.error(
        `Saga ${saga.id} auto-escalated: refundType=${saga.refundType} ` +
          `source=${saga.sourceId} customer=${saga.customerId} ` +
          `amountPaise=${saga.amountInPaise.toString()} ageMs=${
            Date.now() - saga.startedAt.getTime()
          }`,
      );

      // Enqueue an admin task with a 4-hour SLA. The customer is
      // waiting for their refund; finance must investigate fast.
      // Uses PR 0.14's enqueueAdminTask + slaHours path; the
      // admin-task-sla-breach cron escalates further if 4h passes
      // without resolution.
      await this.ledger
        .enqueueAdminTask({
          kind: 'REFUND_INSTRUCTION_FAILED',
          // RefundSaga.refundType ⊇ LedgerSourceType (extra REPLACEMENT).
          // Mapper collapses REPLACEMENT → MANUAL for the admin task.
          sourceType: refundTypeToLedgerSource(saga.refundType),
          sourceId: saga.sourceId,
          reason: `Refund saga stuck > ${stuckMinutes}m. Saga ${saga.id} auto-escalated to FAILED.`,
          slaHours: 4,
        })
        .catch((err) =>
          this.logger.error(
            `Failed to enqueue admin task for stuck saga ${saga.id}: ${err?.message ?? err}`,
          ),
        );

      await this.eventBus
        .publish({
          eventName: 'payments.saga.stuck_auto_escalated',
          aggregate: 'RefundSaga',
          aggregateId: saga.id,
          occurredAt: new Date(),
          payload: {
            sagaId: saga.id,
            refundType: saga.refundType,
            sourceId: saga.sourceId,
            customerId: saga.customerId,
            amountInPaise: saga.amountInPaise.toString(),
            stuckMinutes,
            previousStatus: saga.status,
          },
        })
        .catch((err) =>
          this.logger.error(
            `Failed to emit stuck-saga event for ${saga.id}: ${err?.message ?? err}`,
          ),
        );
    }
    return { scanned: candidates.length, escalated };
  }
}
