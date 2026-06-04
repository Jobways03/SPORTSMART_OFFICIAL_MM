import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';

/**
 * Phase 168 (COD Mark-Paid audit #11) — COD-collection-pending recon cron.
 *
 * A COD order whose sub-orders are all DELIVERED but whose paymentStatus is
 * still PENDING means the delivery agent's cash has not been recorded as
 * collected. Pre-168 such rows sat invisible forever — no job compared
 * "delivered COD" against "marked-paid COD", so uncollected cash silently
 * accrued with nothing surfacing it.
 *
 * Each tick finds COD orders DELIVERED for longer than the configured window
 * and still PENDING, and enqueues a (deduped) COD_COLLECTION_OVERDUE admin task
 * so finance chases the cash. Idempotent on (kind, sourceType=MANUAL,
 * sourceId=orderId) inside AdminTaskService — re-ticks hit the existing row.
 *
 * Follows the modern recon pattern (@Cron + LeaderElectedCron +
 * CronInstrumentation), like refund-gateway-recon.cron.ts.
 */
@Injectable()
export class CodCollectionPendingCron {
  private readonly logger = new Logger(CodCollectionPendingCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly ledger: LiabilityLedgerPublicFacade,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  private enabled(): boolean {
    return this.env.getBoolean('COD_COLLECTION_PENDING_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_4_HOURS)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('cod-collection-pending', 10 * 60, async () => {
      try {
        await this.instr.wrap('reconciliation.cod_collection_pending', () =>
          this.tick(),
        );
      } catch {
        // recorded as FAILED in cron_runs
      }
    });
  }

  async tick(): Promise<{ overdue: number; enqueued: number }> {
    const stuckHours = this.env.getNumber('COD_COLLECTION_PENDING_STUCK_HOURS', 72);
    const cutoff = new Date(Date.now() - stuckHours * 3_600_000);
    const batch = this.env.getNumber('COD_COLLECTION_PENDING_BATCH', 100);

    // Delivered-but-uncollected COD orders. We key the "delivered long enough"
    // test off the master's updatedAt as a coarse proxy for "reached DELIVERED a
    // while ago" — the (payment_method, order_status, payment_status) index
    // serves the predicate; updatedAt narrows to genuinely-aged rows.
    const overdue = await this.prisma.masterOrder.findMany({
      where: {
        paymentMethod: 'COD',
        orderStatus: 'DELIVERED',
        paymentStatus: 'PENDING',
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmountInPaise: true,
        updatedAt: true,
      },
      take: batch,
      orderBy: { updatedAt: 'asc' },
    });

    let enqueued = 0;
    for (const o of overdue) {
      try {
        await this.ledger.enqueueAdminTask({
          kind: 'COD_COLLECTION_OVERDUE',
          sourceType: 'MANUAL',
          sourceId: o.id,
          reason:
            `COD order ${o.orderNumber} has been DELIVERED for over ${stuckHours}h ` +
            `but payment is still PENDING (₹${(Number(o.totalAmountInPaise) / 100).toFixed(2)} ` +
            `cash not recorded as collected). Confirm collection or investigate.`,
          slaHours: 24,
        });
        enqueued++;
      } catch (err) {
        this.logger.error(
          `cod-collection-pending: failed to enqueue task for order ${o.id}: ${
            (err as Error)?.message ?? err
          }`,
        );
      }
    }

    this.logger.log(
      `cod-collection-pending: overdue=${overdue.length} enqueued=${enqueued} (stuck>${stuckHours}h)`,
    );
    return { overdue: overdue.length, enqueued };
  }
}
