import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

const BATCH_SIZE = 100;

/**
 * Phase 120 — Support SLA-breach sweep.
 *
 * setPriority recomputes `slaTargetAt` (URGENT 4h … LOW 5d) on every change,
 * but nothing consumed it — a breached ticket sat unflagged, and the
 * `escalationLevel` / `escalatedAt` columns were dead. This cron closes that:
 * every 30 min it finds still-open tickets past their SLA target that haven't
 * been escalated yet, marks them (escalationLevel 0→1, escalatedAt=now), writes
 * an audit row, and emits `tickets.sla_breached` for downstream notification.
 *
 * Dedup: the `escalationLevel = 0` filter + the per-row CAS
 * (`updateMany WHERE escalationLevel = 0`) make a still-breached ticket
 * escalate exactly once, so re-runs (and multi-replica races) don't re-fire.
 *
 * Multi-replica safety: LeaderElectedCron. Env-flag:
 * SUPPORT_SLA_SWEEP_ENABLED (default true).
 */
@Injectable()
export class SlaBreachSweepCron {
  private readonly logger = new Logger(SlaBreachSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (!this.env.getBoolean('SUPPORT_SLA_SWEEP_ENABLED', true)) return;
    await this.leader.run('support-sla-breach-sweep', 10 * 60, async () => {
      try {
        await this.instr.wrap('support-sla-breach-sweep', () =>
          this.sweepOnce(),
        );
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async sweepOnce(): Promise<{ scanned: number; escalated: number }> {
    const now = new Date();
    // `slaTargetAt: { lt: now }` excludes nulls (Prisma treats null as
    // not-less-than), so tickets with no SLA target are skipped.
    const candidates = await this.prisma.ticket.findMany({
      where: {
        status: { notIn: ['RESOLVED', 'CLOSED'] },
        slaTargetAt: { lt: now },
        escalationLevel: 0,
      },
      select: {
        id: true,
        ticketNumber: true,
        priority: true,
        assignedAdminId: true,
        slaTargetAt: true,
      },
      take: BATCH_SIZE,
      orderBy: { slaTargetAt: 'asc' },
    });

    if (candidates.length === 0) return { scanned: 0, escalated: 0 };
    this.logger.warn(`Found ${candidates.length} SLA-breached ticket(s)`);

    let escalated = 0;
    for (const t of candidates) {
      // CAS: only the writer that flips escalationLevel 0→1 fires the side
      // effects; a concurrent tick gets count=0 and skips.
      const result = await this.prisma.ticket.updateMany({
        where: { id: t.id, escalationLevel: 0 },
        data: { escalationLevel: 1, escalatedAt: now },
      });
      if (result.count === 0) continue;
      escalated++;

      this.audit
        .writeAuditLog({
          action: 'ticket.sla_breached',
          module: 'support',
          resource: 'ticket',
          resourceId: t.id,
          metadata: {
            ticketNumber: t.ticketNumber,
            priority: t.priority,
            slaTargetAt: t.slaTargetAt?.toISOString() ?? null,
            assignedAdminId: t.assignedAdminId,
          },
        })
        .catch(() => undefined);

      await this.eventBus
        .publish({
          eventName: 'tickets.sla_breached',
          aggregate: 'Ticket',
          aggregateId: t.id,
          occurredAt: now,
          payload: {
            ticketId: t.id,
            ticketNumber: t.ticketNumber,
            priority: t.priority,
            assignedAdminId: t.assignedAdminId,
            slaTargetAt: t.slaTargetAt?.toISOString() ?? null,
          },
        })
        .catch(() => undefined);
    }
    return { scanned: candidates.length, escalated };
  }
}
