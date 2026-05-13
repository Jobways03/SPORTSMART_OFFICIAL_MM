import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryModule } from '../../modules/inventory/module';
import { ReconciliationModule } from '../../modules/reconciliation/module';
import { CronJobsService } from './cron-jobs.service';
import { LeaderElectedCron } from './leader-elected-cron';
import { POLLER_CHECKPOINT_REPOSITORY } from './poller-checkpoint.repository';
import { PrismaPollerCheckpointRepository } from './prisma-poller-checkpoint.repository';

/**
 * Centralised cron host. Adding @nestjs/schedule's ScheduleModule once
 * here lets any module declare @Cron() on its methods.
 *
 * CronJobsService owns the cross-module periodic jobs:
 *   - hourly low-stock sweep
 *   - hourly ticket SLA breach check
 *   - daily reconciliation (PAYMENT/COD/REFUND/SETTLEMENT/WALLET)
 *   - daily PENDING-file cleanup (older than 24h)
 *
 * Phase 1 (PR 1.1) — `LeaderElectedCron` is exported (global module) so
 * every @Cron-decorated service can wrap its body with cluster-wide
 * leader election. PR 1.2 migrates the existing crons; new crons should
 * use it from day one.
 *
 * Phase 1 (PR 1.11) — `POLLER_CHECKPOINT_REPOSITORY` is also exported
 * globally so integration pollers (iThink tracking, future Razorpay
 * status polls, etc.) can persist their cursor across restarts and
 * leader bounces.
 */
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    InventoryModule,      // exports LowStockAlertService
    ReconciliationModule, // exports ReconciliationService
  ],
  providers: [
    CronJobsService,
    LeaderElectedCron,
    {
      provide: POLLER_CHECKPOINT_REPOSITORY,
      useClass: PrismaPollerCheckpointRepository,
    },
  ],
  exports: [LeaderElectedCron, POLLER_CHECKPOINT_REPOSITORY],
})
export class SchedulerModule {}
