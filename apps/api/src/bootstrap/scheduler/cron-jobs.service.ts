import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { LowStockAlertService } from '../../modules/inventory/application/services/low-stock-alert.service';
import { ReconciliationService } from '../../modules/reconciliation/application/services/reconciliation.service';
import { computeSlaTarget } from '../../modules/support/application/services/support.service';

/**
 * Cross-module periodic jobs. Each method is fire-and-forget — failures
 * log + continue, never block the next tick.
 */
@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lowStock: LowStockAlertService,
    private readonly recon: ReconciliationService,
  ) {}

  /** Hourly — refresh low-stock alerts on seller mappings. */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyLowStockSweep() {
    try {
      const result = await this.lowStock.sweep();
      this.logger.log(`[cron] low-stock: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error(`[cron] low-stock failed: ${(err as Error).message}`);
    }
  }

  /**
   * Hourly — escalate tickets whose SLA target has passed and they're
   * still in OPEN/IN_PROGRESS/AWAITING_INFO. Bumps priority one notch
   * (LOW→NORMAL→HIGH→URGENT, capped). Doesn't re-escalate within 6h.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async ticketSlaBreachCheck() {
    try {
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
    } catch (err) {
      this.logger.error(`[cron] ticket-SLA failed: ${(err as Error).message}`);
    }
  }

  /**
   * Daily at 02:00 — run all 5 reconciliation kinds for the prior 24h.
   * Discrepancies notify ops via the existing event handler.
   */
  @Cron('0 2 * * *')
  async dailyReconciliation() {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const kinds: Array<'PAYMENT' | 'COD' | 'SETTLEMENT' | 'REFUND' | 'WALLET'> = [
      'PAYMENT', 'COD', 'SETTLEMENT', 'REFUND', 'WALLET',
    ];
    for (const kind of kinds) {
      try {
        await this.recon.runAndCollect({ kind, periodStart: start, periodEnd: end });
        this.logger.log(`[cron] recon ${kind} complete`);
      } catch (err) {
        this.logger.error(`[cron] recon ${kind} failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Daily at 03:00 — soft-delete PENDING file uploads older than 24h.
   * Storage objects are NOT removed; admin can run a separate cleanup.
   */
  @Cron('0 3 * * *')
  async cleanupStalePendingFiles() {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await this.prisma.fileMetadata.updateMany({
        where: { status: 'PENDING', expiresAt: { lt: cutoff } },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      if (result.count > 0) {
        this.logger.log(`[cron] cleaned up ${result.count} stale PENDING files`);
      }
    } catch (err) {
      this.logger.error(`[cron] file cleanup failed: ${(err as Error).message}`);
    }
  }
}
