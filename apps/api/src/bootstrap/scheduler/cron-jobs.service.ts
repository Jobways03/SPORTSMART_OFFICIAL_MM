import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { LowStockAlertService } from '../../modules/inventory/application/services/low-stock-alert.service';
import { ReconciliationService } from '../../modules/reconciliation/application/services/reconciliation.service';
import { computeSlaTarget } from '../../modules/support/application/services/support.service';
import { LeaderElectedCron } from './leader-elected-cron';
import { CronInstrumentationService } from '../../core/cron-observability/cron-instrumentation.service';

/**
 * Cross-module periodic jobs. Each method is fire-and-forget — failures
 * log + continue, never block the next tick.
 *
 * Phase 1 (PR 1.2) — every body now runs through `LeaderElectedCron` so
 * only ONE replica per cluster executes per tick. Without this, N
 * replicas would all run the dailyReconciliation in parallel, all run
 * `cleanupStalePendingFiles` in parallel, all bump ticket priorities
 * in parallel — the audit's CRITICAL C1.
 */
@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lowStock: LowStockAlertService,
    private readonly recon: ReconciliationService,
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.4) — cron-run observability. One service hosting
    // four crons → four distinct job names so cron_runs.jobName
    // discriminates per-tick metrics: hourly-low-stock-sweep,
    // ticket-sla-breach, daily-reconciliation, cleanup-stale-pending-files.
    private readonly instr: CronInstrumentationService,
  ) {}

  /** Hourly — refresh low-stock alerts on seller mappings. */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyLowStockSweep() {
    // Lock TTL = 2× tick interval (2 hours) so a slow body doesn't
    // get its lock revoked mid-run on a busy DB.
    await this.leader.run('hourly-low-stock-sweep', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('hourly-low-stock-sweep', async () => {
          const result = await this.lowStock.sweep();
          this.logger.log(`[cron] low-stock: ${JSON.stringify(result)}`);
          // `result` is forwarded verbatim — captures whatever
          // sweep() returns (typed by LowStockAlertService) as the
          // structured per-tick metric in cron_runs.result.
          return result as Record<string, unknown>;
        });
      } catch (err) {
        this.logger.error(`[cron] low-stock failed: ${(err as Error).message}`);
      }
    });
  }

  /**
   * Hourly — escalate tickets whose SLA target has passed and they're
   * still in OPEN/IN_PROGRESS/AWAITING_INFO. Bumps priority one notch
   * (LOW→NORMAL→HIGH→URGENT, capped). Doesn't re-escalate within 6h.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async ticketSlaBreachCheck() {
    await this.leader.run('ticket-sla-breach', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('ticket-sla-breach', async () => {
          const now = new Date();
          const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
          const stuck = await this.prisma.ticket.findMany({
            where: {
              slaTargetAt: { lt: now },
              status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] },
              OR: [{ escalatedAt: null }, { escalatedAt: { lt: sixHoursAgo } }],
            },
            take: 200,
          });

          const NEXT: Record<string, string> = {
            LOW: 'NORMAL', NORMAL: 'HIGH', HIGH: 'URGENT', URGENT: 'URGENT',
          };

          for (const t of stuck) {
            const newPriority = NEXT[t.priority] as any;
            await this.prisma.ticket.update({
              where: { id: t.id },
              data: {
                priority: newPriority,
                slaTargetAt: computeSlaTarget(newPriority, now),
                escalationLevel: t.escalationLevel + 1,
                escalatedAt: now,
              },
            });
          }
          if (stuck.length > 0) {
            this.logger.warn(`[cron] ticket-SLA: escalated ${stuck.length}`);
          }
          return { escalated: stuck.length };
        });
      } catch (err) {
        this.logger.error(`[cron] ticket-SLA failed: ${(err as Error).message}`);
      }
    });
  }

  /**
   * Daily at 02:00 — run all 5 reconciliation kinds for the prior 24h.
   * Discrepancies notify ops via the existing event handler.
   */
  @Cron('0 2 * * *')
  async dailyReconciliation() {
    // Reconciliation can take a while (queries every order, every
    // settlement, every refund row for the past 24h). 6-hour lock so
    // a slow daily run on a large DB completes uninterrupted.
    await this.leader.run('daily-reconciliation', 6 * 60 * 60, async () => {
      try {
        await this.instr.wrap('daily-reconciliation', async () => {
          const end = new Date();
          end.setHours(0, 0, 0, 0);
          const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
          const kinds: Array<'PAYMENT' | 'COD' | 'SETTLEMENT' | 'REFUND' | 'WALLET'> = [
            'PAYMENT', 'COD', 'SETTLEMENT', 'REFUND', 'WALLET',
          ];
          let succeeded = 0;
          let failed = 0;
          for (const kind of kinds) {
            try {
              await this.recon.runAndCollect({ kind, periodStart: start, periodEnd: end });
              this.logger.log(`[cron] recon ${kind} complete`);
              succeeded++;
            } catch (err) {
              failed++;
              this.logger.error(`[cron] recon ${kind} failed: ${(err as Error).message}`);
            }
          }
          // The per-kind result rows are already persisted by recon
          // itself; this counter just reports the per-tick rollup so
          // a partial failure (e.g. WALLET succeeded but SETTLEMENT
          // failed) shows up cleanly in cron_runs without having to
          // join across tables.
          return { kindsTotal: kinds.length, succeeded, failed };
        });
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  /**
   * Daily at 03:00 — soft-delete PENDING file uploads older than 24h.
   * Storage objects are NOT removed; admin can run a separate cleanup.
   */
  @Cron('0 3 * * *')
  async cleanupStalePendingFiles() {
    await this.leader.run('cleanup-stale-pending-files', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('cleanup-stale-pending-files', async () => {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const result = await this.prisma.fileMetadata.updateMany({
            where: { status: 'PENDING', expiresAt: { lt: cutoff } },
            data: { status: 'DELETED', deletedAt: new Date() },
          });
          if (result.count > 0) {
            this.logger.log(`[cron] cleaned up ${result.count} stale PENDING files`);
          }
          return { cleaned: result.count };
        });
      } catch (err) {
        this.logger.error(`[cron] file cleanup failed: ${(err as Error).message}`);
      }
    });
  }
}
