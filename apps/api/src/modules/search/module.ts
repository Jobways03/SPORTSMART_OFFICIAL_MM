import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { OpenSearchModule } from '../../integrations/opensearch/opensearch.module';
import { SearchPublicFacade } from './application/facades/search-public.facade';
import { SearchProductsController } from './presentation/controllers/search-products.controller';
import { SearchExtraController } from './presentation/controllers/rebuild-search-index.controller';
import { ProductApprovedIndexHandler } from './application/event-handlers/product-approved-index.handler';
import { StockUpdatedIndexHandler } from './application/event-handlers/stock-updated-index.handler';

/**
 * Phase 195 (#1/#12) — imports OpenSearchModule (so the adapter resolves)
 * and registers the index sync handlers (previously declared but never in
 * any providers list, so they never fired). With OpenSearch disabled both
 * handlers no-op via the adapter's isConfigured guard, so registering them
 * is safe by default.
 */
@Module({
  imports: [OpenSearchModule],
  controllers: [SearchProductsController, SearchExtraController],
  providers: [
    AdminAuthGuard,
    SearchPublicFacade,
    ProductApprovedIndexHandler,
    StockUpdatedIndexHandler,
  ],
  exports: [SearchPublicFacade],
})
export class SearchModule {}
