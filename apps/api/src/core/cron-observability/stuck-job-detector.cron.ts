import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { EventBusService } from '../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from './cron-instrumentation.service';

/**
 * Phase 10 (2026-05-16) — Stuck-job detector.
 *
 * Some background jobs have a happy-path retry cron of their own
 * (tax PDF, e-invoice, settlement payout) but the retry cron itself
 * can wedge — Redis lock leaked, env flag stuck off, provider
 * blackholed. Without a detector, a stuck row just sits silently
 * until customer support fields the complaint.
 *
 * This cron sweeps rows in known transient states past their
 * tolerance window and emits `ops.stuck_job_detected` for each
 * cohort. The OpsAlertHandler subscribes to that event and emails
 * the platform team (cooldown-throttled).
 *
 * Cohorts watched:
 *   • tax_documents.status = PDF_PENDING > 2h
 *   • tax_documents.einvoice_status = PENDING > 2h
 *   • settlement_cycles.status = PREVIEWED > 24h
 *
 * Each cohort emits a SINGLE event per tick with the count + a few
 * sample ids — we don't fire-hose one event per row.
 */
@Injectable()
export class StuckJobDetectorCron {
  private readonly logger = new Logger(StuckJobDetectorCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  /** Runs hourly; same cadence as ticket-SLA breach. Leader-elected. */
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (
      this.env.getString('STUCK_JOB_DETECTOR_ENABLED', 'true') !== 'true'
    ) {
      return;
    }
    await this.leader.run('stuck-job-detector', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('stuck-job-detector', async () => {
          const now = new Date();
          const pdfDeadline = new Date(now.getTime() - this.toleranceMs('STUCK_TAX_PDF_HOURS', 2));
          const eInvDeadline = new Date(now.getTime() - this.toleranceMs('STUCK_EINVOICE_HOURS', 2));
          const cycleDeadline = new Date(now.getTime() - this.toleranceMs('STUCK_SETTLEMENT_CYCLE_HOURS', 24));

          const cohorts = await Promise.all([
            this.cohort('tax-pdf-pending', pdfDeadline, () =>
              this.prisma.taxDocument.findMany({
                where: { status: 'PDF_PENDING', updatedAt: { lt: pdfDeadline } },
                select: { id: true, documentNumber: true, updatedAt: true },
                orderBy: { updatedAt: 'asc' },
                take: 20,
              }),
            ),
            this.cohort('einvoice-pending', eInvDeadline, () =>
              this.prisma.taxDocument.findMany({
                where: { einvoiceStatus: 'PENDING', updatedAt: { lt: eInvDeadline } },
                select: { id: true, documentNumber: true, updatedAt: true },
                orderBy: { updatedAt: 'asc' },
                take: 20,
              }),
            ),
            this.cohort('settlement-cycle-previewed', cycleDeadline, () =>
              this.prisma.settlementCycle.findMany({
                where: { status: 'PREVIEWED', updatedAt: { lt: cycleDeadline } },
                select: { id: true, periodStart: true, periodEnd: true, updatedAt: true },
                orderBy: { updatedAt: 'asc' },
                take: 20,
              }),
            ),
          ]);

          const totals = cohorts.reduce((acc, c) => acc + c.count, 0);
          if (totals > 0) {
            this.logger.warn(
              `[stuck-job-detector] cohorts past tolerance: ${cohorts.map((c) => `${c.name}=${c.count}`).join(', ')}`,
            );
          }
          return {
            totalStuck: totals,
            cohorts: cohorts.map((c) => ({ name: c.name, count: c.count })),
          };
        });
      } catch (err) {
        this.logger.error(
          `[stuck-job-detector] crashed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Read a per-cohort tolerance from env. Reads via process.env so
   * the helper can accept the few specific keys we care about without
   * threading `keyof Env` types through every call.
   */
  private toleranceMs(
    key: 'STUCK_TAX_PDF_HOURS' | 'STUCK_EINVOICE_HOURS' | 'STUCK_SETTLEMENT_CYCLE_HOURS',
    defaultHours: number,
  ): number {
    return this.env.getNumber(key, defaultHours) * 60 * 60 * 1000;
  }

  private async cohort(
    name: string,
    deadline: Date,
    query: () => Promise<Array<{ id: string }>>,
  ): Promise<{ name: string; count: number }> {
    const rows = await query();
    if (rows.length === 0) return { name, count: 0 };

    // Emit one event per cohort with a sample of ids — keeps the
    // ops inbox readable. The OpsAlertHandler cooldown then prevents
    // hourly mail-bombs if the cohort persists.
    await this.eventBus
      .publish({
        eventName: 'ops.stuck_job_detected',
        aggregate: 'StuckJobCohort',
        aggregateId: name,
        occurredAt: new Date(),
        payload: {
          cohort: name,
          count: rows.length,
          olderThan: deadline.toISOString(),
          sampleIds: rows.slice(0, 10).map((r) => r.id),
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `[stuck-job-detector] failed to emit cohort=${name}: ${(err as Error).message}`,
        );
      });
    return { name, count: rows.length };
  }
}
