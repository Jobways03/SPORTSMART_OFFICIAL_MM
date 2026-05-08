import { Global, Module } from '@nestjs/common';
import { FileUrlAuditService } from './file-url-audit.service';
import { IntegrityVerifierCron } from './integrity-verifier.cron';

/**
 * Phase 7 — file integrity helpers. The hash util is a pure function
 * (no DI), so this module only provides the URL audit service and
 * the verifier cron.
 */
@Global()
@Module({
  providers: [FileUrlAuditService, IntegrityVerifierCron],
  exports: [FileUrlAuditService],
})
export class FileIntegrityModule {}
