import { Global, Module } from '@nestjs/common';
import { CronInstrumentationService } from './cron-instrumentation.service';
import { CronHeartbeatCron } from './cron-heartbeat.cron';
import { CronHeartbeatSeeder } from './cron-heartbeat-seeder';
import { OpsAlertHandler } from './ops-alert.handler';
import { StuckJobDetectorCron } from './stuck-job-detector.cron';
import { EmailModule } from '../../integrations/email/email.module';

/**
 * Phase 8 (PR 8.3) — global cron observability module. Domain crons
 * inject `CronInstrumentationService.wrap(name, fn)` to record
 * structured run history; the heartbeat cron rides alongside.
 *
 * Phase 5 (PR 5.5) — `CronHeartbeatSeeder` upserts the documented
 * heartbeat targets on boot so the detector has something to watch
 * for. Idempotent — operator tweaks to existing rows are preserved.
 *
 * Phase 10 (2026-05-16) — `OpsAlertHandler` subscribes to the small
 * set of events that should page the platform team (cron silent,
 * ledger imbalance, HTTP error-rate spike, file integrity violation,
 * stuck refund saga) and emails ADMIN_ESCALATION_EMAIL. Cooldown-
 * throttled so a spike doesn't mail-bomb the inbox.
 */
@Global()
@Module({
  imports: [EmailModule],
  providers: [
    CronInstrumentationService,
    CronHeartbeatCron,
    CronHeartbeatSeeder,
    OpsAlertHandler,
    StuckJobDetectorCron,
  ],
  exports: [CronInstrumentationService],
})
export class CronObservabilityModule {}
