import { Global, Module } from '@nestjs/common';
import { SlaTrackerService } from './sla-tracker.service';
import { SlaEscalationService } from './services/sla-escalation.service';
import { SlaBreachDetectorCron } from './jobs/sla-breach-detector.cron';

/**
 * Phase 6 — global SLA module. Wired so domain modules (returns,
 * disputes, support) can inject SlaTrackerService without each
 * importing the SLA infrastructure piecemeal. Same pattern as
 * GuardsModule and CaseDuplicateModule.
 *
 * The breach-detector cron + escalation service are also providers
 * here. Cron registration is automatic via @Cron(); the service
 * instance is constructed even when the flag is off (it just
 * short-circuits inside `run()`).
 */
@Global()
@Module({
  providers: [
    SlaTrackerService,
    SlaEscalationService,
    SlaBreachDetectorCron,
  ],
  exports: [
    SlaTrackerService,
    SlaEscalationService,
  ],
})
export class SlaModule {}
