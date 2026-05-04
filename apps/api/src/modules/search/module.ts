import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { SearchPublicFacade } from './application/facades/search-public.facade';
import { SearchProductsController } from './presentation/controllers/search-products.controller';
import { SearchExtraController } from './presentation/controllers/rebuild-search-index.controller';

@Module({
  controllers: [SearchProductsController, SearchExtraController],
  providers: [AdminAuthGuard, SearchPublicFacade],
  exports: [SearchPublicFacade],
})
export class SearchModule {}
