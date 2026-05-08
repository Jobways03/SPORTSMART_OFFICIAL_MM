import { Global, Module } from '@nestjs/common';
import { CronInstrumentationService } from './cron-instrumentation.service';
import { CronHeartbeatCron } from './cron-heartbeat.cron';

/**
 * Phase 8 (PR 8.3) — global cron observability module. Domain crons
 * inject `CronInstrumentationService.wrap(name, fn)` to record
 * structured run history; the heartbeat cron rides alongside.
 */
@Global()
@Module({
  providers: [CronInstrumentationService, CronHeartbeatCron],
  exports: [CronInstrumentationService],
})
export class CronObservabilityModule {}
