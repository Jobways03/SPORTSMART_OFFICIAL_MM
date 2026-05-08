import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard, AnyAuthGuard, UserAuthGuard } from '../guards';
import { CaseTimelineService } from './case-timeline.service';
import { PortalTimelineController } from './portal-timeline.controller';

/**
 * Phase 9 (PR 9.3) — case timeline module. Pure-read; no domain
 * mutations. Joins read-only data from returns / disputes / support.
 */
@Global()
@Module({
  controllers: [PortalTimelineController],
  providers: [
    CaseTimelineService,
    AdminAuthGuard,
    AnyAuthGuard,
    UserAuthGuard,
  ],
  exports: [CaseTimelineService],
})
export class CaseTimelineModule {}
