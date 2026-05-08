import { Global, Module } from '@nestjs/common';
import { LegalHoldService } from './legal-hold.service';
import { RetentionEnforcerCron } from './retention-enforcer.cron';

/**
 * Phase 7 (PR 7.2) — global retention module. Same shape as SLA / Risk.
 * The enforcer cron registers automatically via @Cron; the legal-hold
 * service is exported for any future caller (e.g. a manual admin
 * delete needs to consult it before issuing the delete).
 */
@Global()
@Module({
  providers: [LegalHoldService, RetentionEnforcerCron],
  exports: [LegalHoldService],
})
export class RetentionModule {}
