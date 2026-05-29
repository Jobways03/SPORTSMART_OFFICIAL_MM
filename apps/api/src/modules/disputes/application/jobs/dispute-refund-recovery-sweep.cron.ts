import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { DisputeService } from '../services/dispute.service';

const BATCH_SIZE = 100;
// Don't touch a just-decided dispute — give decide()'s own post-txn step
// time to mint the instruction before the sweep considers it stranded.
const GRACE_MINUTES = 10;

/**
 * Phase 126 — dispute-decision settlement recovery.
 *
 * DisputeService.decide() commits the dispute status + `disputes.decided`
 * outbox event in one transaction, then creates the customer's
 * RefundInstruction OUTSIDE that transaction. If the process is killed
 * between the commit and that step, the dispute is RESOLVED and the event
 * is in the outbox, but the customer's refund was never enqueued — and no
 * `disputes.decided` subscriber mints one (the mirror + notification
 * handlers don't move money). The customer sees "resolved" but never gets
 * credited.
 *
 * This cron recovers those: every 5 min it finds disputes decided in the
 * lookback window with a customer-owed remedy + positive amount and asks
 * DisputeService to ensure the RefundInstruction exists. That call is
 * idempotent (createForDispute dedups on `dispute:${id}`), so a sweep
 * racing a slow decide() can't double-refund. Gated by
 * DISPUTE_REFUND_RECOVERY_SWEEP_ENABLED.
 */
@Injectable()
export class DisputeRefundRecoverySweepCron {
  private readonly logger = new Logger(DisputeRefundRecoverySweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly disputes: DisputeService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.env.getBoolean('DISPUTE_REFUND_RECOVERY_SWEEP_ENABLED', true)) {
      return;
    }
    await this.leader.run('dispute-refund-recovery-sweep', 10 * 60, async () => {
      try {
        await this.instr.wrap('dispute-refund-recovery-sweep', () =>
          this.sweepOnce(),
        );
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async sweepOnce(): Promise<{ scanned: number; recovered: number }> {
    const now = Date.now();
    const lookbackMin = this.env.getNumber(
      'DISPUTE_REFUND_RECOVERY_LOOKBACK_MINUTES',
      1440, // 24h — comfortably ahead of the 24h refund-failure AdminTask SLA
    );
    // Hits the @@index([customerRemedy, decisionAt]) on Dispute. The
    // remedy + amount filter is the precise "customer is owed money" gate;
    // the decisionAt window both bounds the scan and proves the row is
    // actually decided.
    const candidates = await this.prisma.dispute.findMany({
      where: {
        customerRemedy: {
          in: ['FULL_REFUND', 'PARTIAL_REFUND', 'GOODWILL_CREDIT'],
        },
        decisionAmountInPaise: { gt: 0 },
        decisionAt: {
          gte: new Date(now - lookbackMin * 60 * 1000),
          lt: new Date(now - GRACE_MINUTES * 60 * 1000),
        },
      },
      select: { id: true, disputeNumber: true },
      take: BATCH_SIZE,
      orderBy: { decisionAt: 'asc' },
    });

    if (candidates.length === 0) return { scanned: 0, recovered: 0 };

    let recovered = 0;
    for (const d of candidates) {
      try {
        const outcome =
          await this.disputes.ensureRefundInstructionForDecidedDispute(d.id);
        if (outcome === 'created') recovered++;
      } catch (err) {
        this.logger.error(
          `Recovery failed for dispute ${d.disputeNumber} (${d.id}): ${
            (err as Error).message
          }`,
        );
      }
    }
    if (recovered > 0) {
      this.logger.warn(
        `Recovery: minted ${recovered} missing dispute RefundInstruction(s)`,
      );
    }
    return { scanned: candidates.length, recovered };
  }
}
