import { Global, Module } from '@nestjs/common';
import { CronInstrumentationService } from './cron-instrumentation.service';
import { CronHeartbeatCron } from './cron-heartbeat.cron';
import { CronHeartbeatSeeder } from './cron-heartbeat-seeder';

/**
 * Phase 8 (PR 8.3) — global cron observability module. Domain crons
 * inject `CronInstrumentationService.wrap(name, fn)` to record
 * structured run history; the heartbeat cron rides alongside.
 *
 * Phase 5 (PR 5.5) — `CronHeartbeatSeeder` upserts the documented
 * heartbeat targets on boot so the detector has something to watch
 * for. Idempotent — operator tweaks to existing rows are preserved.
 */
@Global()
@Module({
  providers: [CronInstrumentationService, CronHeartbeatCron, CronHeartbeatSeeder],
  exports: [CronInstrumentationService],
})
export class CronObservabilityModule {}
