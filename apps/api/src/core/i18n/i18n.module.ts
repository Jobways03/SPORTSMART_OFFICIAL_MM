import { Global, Module } from '@nestjs/common';
import { MessageCatalogueService } from './message-catalogue.service';

/**
 * Phase 9 (PR 9.2) — global i18n module. Domain code injects
 * `MessageCatalogueService.render(key, input, vars)` and gets a
 * locale-resolved string.
 */
@Global()
@Module({
  providers: [MessageCatalogueService],
  exports: [MessageCatalogueService],
})
export class I18nModule {}
