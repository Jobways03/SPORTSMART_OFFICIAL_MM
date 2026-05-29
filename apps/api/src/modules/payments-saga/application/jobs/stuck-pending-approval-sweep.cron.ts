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

/** RefundSourceType ⊇ LedgerSourceType (extra REPLACEMENT → MANUAL). */
function refundTypeToLedgerSource(t: RefundSourceType): LedgerSourceType {
  switch (t) {
    case 'RETURN':
      return 'RETURN';
    case 'DISPUTE':
      return 'DISPUTE';
    case 'GOODWILL':
      return 'GOODWILL';
    default:
      return 'MANUAL';
  }
}

/**
 * Phase 116 — Stuck PENDING_APPROVAL sweep.
 *
 * A RefundInstruction created above the auto-approve threshold (or any
 * goodwill credit) lands in PENDING_APPROVAL and waits for finance to act
 * via /admin/refund-instructions/:id/approve. The existing StuckSagaSweepCron
 * only covers *running* sagas — an instruction that finance never looks at
 * sits in PENDING_APPROVAL indefinitely while the customer waits for money,
 * with no proactive escalation.
 *
 * This cron closes that gap. Every 30 minutes:
 *   1. Find RefundInstruction.status='PENDING_APPROVAL' AND createdAt older
 *      than REFUND_PENDING_APPROVAL_STUCK_HOURS (default 48h).
 *   2. Enqueue an AdminTask (REFUND_INSTRUCTION_FAILED, SLA 24h). Note we do
 *      NOT change the instruction status — it must stay PENDING_APPROVAL so
 *      finance can still approve it. Dedup is handled by enqueueAdminTask's
 *      UNIQUE(kind, sourceType, sourceId): re-running the sweep is idempotent
 *      (P2002 → returns the existing task), so a still-stuck instruction
 *      doesn't spawn a new task every tick.
 *   3. Emit refunds.instruction.pending_approval_stuck for downstream
 *      handlers (notifications, audit).
 *
 * Multi-replica safety: LeaderElectedCron. Env-flag:
 * REFUND_PENDING_APPROVAL_SWEEP_ENABLED (default true).
 */
@Injectable()
export class StuckPendingApprovalSweepCron {
  private readonly logger = new Logger(StuckPendingApprovalSweepCron.name);
  private static readonly DEFAULT_STUCK_HOURS = 48;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly ledger: LiabilityLedgerPublicFacade,
    private readonly instr: CronInstrumentationService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (!this.env.getBoolean('REFUND_PENDING_APPROVAL_SWEEP_ENABLED', true)) {
      return;
    }
    await this.leader.run('stuck-pending-approval-sweep', 10 * 60, async () => {
      try {
        await this.instr.wrap('stuck-pending-approval-sweep', () =>
          this.sweepOnce(),
        );
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async sweepOnce(): Promise<{ scanned: number; escalated: number }> {
    const stuckHours = this.env.getNumber(
      'REFUND_PENDING_APPROVAL_STUCK_HOURS',
      StuckPendingApprovalSweepCron.DEFAULT_STUCK_HOURS,
    );
    const cutoff = new Date(Date.now() - stuckHours * 60 * 60 * 1000);

    const candidates = await this.prisma.refundInstruction.findMany({
      where: { status: 'PENDING_APPROVAL', createdAt: { lt: cutoff } },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        customerId: true,
        amountInPaise: true,
        createdAt: true,
      },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    if (candidates.length === 0) return { scanned: 0, escalated: 0 };
    this.logger.warn(
      `Found ${candidates.length} refund instruction(s) stuck in PENDING_APPROVAL past ${stuckHours}h`,
    );

    let escalated = 0;
    for (const inst of candidates) {
      // enqueueAdminTask dedups on UNIQUE(kind, sourceType, sourceId), so a
      // still-stuck instruction re-found on the next tick won't create a
      // second task. We deliberately leave the instruction PENDING_APPROVAL.
      await this.ledger
        .enqueueAdminTask({
          kind: 'REFUND_INSTRUCTION_FAILED',
          sourceType: refundTypeToLedgerSource(inst.sourceType),
          sourceId: inst.sourceId,
          reason:
            `Refund instruction ${inst.id} (customer ${inst.customerId}, ` +
            `${inst.amountInPaise.toString()} paise) has been awaiting finance ` +
            `approval for > ${stuckHours}h.`,
          slaHours: 24,
        })
        .then(() => {
          escalated++;
        })
        .catch((err) =>
          this.logger.error(
            `Failed to enqueue admin task for stuck instruction ${inst.id}: ${
              (err as Error).message
            }`,
          ),
        );

      await this.eventBus
        .publish({
          eventName: 'refunds.instruction.pending_approval_stuck',
          aggregate: 'RefundInstruction',
          aggregateId: inst.id,
          occurredAt: new Date(),
          payload: {
            instructionId: inst.id,
            sourceType: inst.sourceType,
            sourceId: inst.sourceId,
            customerId: inst.customerId,
            amountInPaise: inst.amountInPaise.toString(),
            stuckHours,
          },
        })
        .catch(() => undefined);
    }
    return { scanned: candidates.length, escalated };
  }
}
