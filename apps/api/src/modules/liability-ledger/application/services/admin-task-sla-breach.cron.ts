import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';

const BATCH_SIZE = 50;

/**
 * Phase 0 (PR 0.14) — SLA-breach detector for admin_tasks.
 *
 * Picks OPEN / CLAIMED tasks where `slaBreachAt < now()` and
 * `slaBreachedAt IS NULL`. For each, emits an escalation event
 * (which the notifications module subscribes to and emails finance
 * lead) and marks `slaBreachedAt = now()` so the cron doesn't
 * re-fire on the next tick.
 *
 * Why a dedicated cron rather than reusing the SLA-breach detector
 * for tickets/returns (`core/sla/jobs/sla-breach-detector.cron.ts`):
 *   - That detector queries `SlaPolicy` rows keyed on resource type;
 *     admin_tasks don't fit that model (the SLA is per-task instance,
 *     not per-policy).
 *   - Keeping admin-task SLA logic inside the liability-ledger module
 *     preserves the strict modular-monolith boundary — `SlaModule`
 *     stays focused on customer-visible support cases.
 *
 * Cadence: every 5 minutes. Tasks landing right after a tick wait at
 * most 5 minutes past their actual deadline before being flagged —
 * acceptable when the smallest SLA (24h) is 3 orders of magnitude
 * longer than the tick interval.
 *
 * Multi-replica safety: each tick takes Redis lock 'cron:admin-task-
 * sla-breach' via leader-election (TODO PR 1.2; until then the
 * idempotent `updateMany WHERE slaBreachedAt IS NULL` guards against
 * double-fire — only one replica's UPDATE will see a non-null row).
 */
@Injectable()
export class AdminTaskSlaBreachCron {
  private readonly logger = new Logger(AdminTaskSlaBreachCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly env: EnvService,
    // Phase 1 (PR 1.2) — backstop the CAS-on-slaBreachedAt guard
    // (PR 0.14) with cluster-wide leader-election so we don't even
    // bother running the findMany on losers.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.2) — cron-run observability. Captures
    // `{ scanned, escalated }` per tick in cron_runs.
    private readonly instr: CronInstrumentationService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    // Allow ops to silence the cron without redeploying. Default on so
    // dispute refund failures are escalated by default.
    if (!this.env.getBoolean('ADMIN_TASK_SLA_BREACH_ENABLED', true)) {
      return;
    }

    await this.leader.run('admin-task-sla-breach', 10 * 60, async () => {
      try {
        await this.instr.wrap('admin-task-sla-breach', () => this.sweepOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async sweepOnce(): Promise<{ scanned: number; escalated: number }> {
    const now = new Date();
    const breached = await this.prisma.adminTask.findMany({
      where: {
        status: { in: ['OPEN', 'CLAIMED'] },
        slaBreachAt: { lte: now },
        slaBreachedAt: null,
      },
      select: {
        id: true,
        kind: true,
        sourceType: true,
        sourceId: true,
        reason: true,
        slaBreachAt: true,
        assignedTo: true,
      },
      take: BATCH_SIZE,
      orderBy: { slaBreachAt: 'asc' },
    });

    if (breached.length === 0) return { scanned: 0, escalated: 0 };
    this.logger.warn(`Found ${breached.length} SLA-breached admin task(s)`);

    let escalated = 0;
    for (const task of breached) {
      // Mark FIRST so a concurrent replica doesn't double-fire the
      // event. `updateMany WHERE slaBreachedAt IS NULL` is the CAS:
      // exactly one writer flips it from null to a value.
      const result = await this.prisma.adminTask.updateMany({
        where: { id: task.id, slaBreachedAt: null },
        data: { slaBreachedAt: now },
      });
      if (result.count === 0) {
        // Another replica beat us; skip.
        continue;
      }
      escalated++;

      this.logger.warn(
        `Escalating SLA-breached admin task ${task.id}: kind=${task.kind} ` +
          `source=${task.sourceType}:${task.sourceId} ` +
          `deadline=${task.slaBreachAt?.toISOString() ?? 'unknown'}`,
      );

      // Best-effort emit; failure here logs but does not unwind the
      // breach marker (because the marker is the load-bearing
      // dedup signal — we'd rather miss one Slack ping than fire it
      // every 5 minutes forever).
      await this.eventBus
        .publish({
          eventName:
            task.kind === 'REFUND_INSTRUCTION_FAILED'
              ? 'disputes.refund_failure.sla_breached'
              : 'liability.admin_task.sla_breached',
          aggregate: 'AdminTask',
          aggregateId: task.id,
          occurredAt: now,
          payload: {
            adminTaskId: task.id,
            kind: task.kind,
            sourceType: task.sourceType,
            sourceId: task.sourceId,
            reason: task.reason,
            deadline: task.slaBreachAt?.toISOString() ?? null,
            assignedTo: task.assignedTo ?? null,
          },
        })
        .catch((err) =>
          this.logger.error(
            `Failed to emit SLA-breached event for task ${task.id}: ${err?.message ?? err}`,
          ),
        );
    }
    return { scanned: breached.length, escalated };
  }
}
