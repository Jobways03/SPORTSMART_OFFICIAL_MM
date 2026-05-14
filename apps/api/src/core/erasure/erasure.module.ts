import { Global, Module } from '@nestjs/common';
import { ErasureService } from './erasure.service';
import { ErasureProcessorCron } from './erasure-processor.cron';
import { TaxModule } from '../../modules/tax/module';

/**
 * Phase 7 (PR 7.4) — global erasure module. The service is exported
 * so admin / user controllers can call requestErasure / cancel
 * without per-module wiring.
 *
 * Phase 21 GST — imports TaxModule for TaxDocumentRetentionService.
 * The erasure outcome JSON records the user's tax-document statutory
 * hold so admins can see "PII redacted on users row; N documents
 * preserved under Section 36" without inferring it later.
 */
@Global()
@Module({
  imports: [TaxModule],
  providers: [ErasureService, ErasureProcessorCron],
  exports: [ErasureService],
})
export class ErasureModule {}
