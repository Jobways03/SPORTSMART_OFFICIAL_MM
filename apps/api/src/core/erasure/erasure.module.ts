import { Global, Module } from '@nestjs/common';
import { ErasureService } from './erasure.service';
import { ErasureProcessorCron } from './erasure-processor.cron';

/**
 * Phase 7 (PR 7.4) — global erasure module. The service is exported
 * so admin / user controllers can call requestErasure / cancel
 * without per-module wiring.
 */
@Global()
@Module({
  providers: [ErasureService, ErasureProcessorCron],
  exports: [ErasureService],
})
export class ErasureModule {}
