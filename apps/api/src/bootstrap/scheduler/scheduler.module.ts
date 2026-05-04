import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryModule } from '../../modules/inventory/module';
import { ReconciliationModule } from '../../modules/reconciliation/module';
import { CronJobsService } from './cron-jobs.service';

/**
 * Centralised cron host. Adding @nestjs/schedule's ScheduleModule once
 * here lets any module declare @Cron() on its methods.
 *
 * CronJobsService owns the cross-module periodic jobs:
 *   - hourly low-stock sweep
 *   - hourly ticket SLA breach check
 *   - daily reconciliation (PAYMENT/COD/REFUND/SETTLEMENT/WALLET)
 *   - daily PENDING-file cleanup (older than 24h)
 */
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    InventoryModule,      // exports LowStockAlertService
    ReconciliationModule, // exports ReconciliationService
  ],
  providers: [CronJobsService],
  exports: [],
})
export class SchedulerModule {}
