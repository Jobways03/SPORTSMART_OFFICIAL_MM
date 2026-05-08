import { Global, Module } from '@nestjs/common';
import { CaseDuplicateService } from './case-duplicate.service';

/**
 * Global module so ReturnService / DisputeService / SupportService can
 * inject CaseDuplicateService without each domain module needing an
 * explicit import. Phase-1 foundation; doesn't depend on any domain
 * module itself.
 */
@Global()
@Module({
  providers: [CaseDuplicateService],
  exports: [CaseDuplicateService],
})
export class CaseDuplicateModule {}
