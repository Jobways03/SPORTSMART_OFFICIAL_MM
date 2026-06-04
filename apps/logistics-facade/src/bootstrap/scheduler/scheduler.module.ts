import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

/**
 * Central host for @Cron-decorated services. Mirrors
 * apps/api/src/bootstrap/scheduler/scheduler.module.ts. M0 declares
 * no cron bodies — modules/cod-remittance/pull-remittance.cron.ts
 * is a registered-but-disabled stub.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  exports: [ScheduleModule],
})
export class SchedulerModule {}
