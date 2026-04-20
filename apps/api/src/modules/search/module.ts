import { Module } from '@nestjs/common';
import { SearchPublicFacade } from './application/facades/search-public.facade';
import { SearchProductsController } from './presentation/controllers/search-products.controller';

@Module({
  controllers: [SearchProductsController],
  providers: [SearchPublicFacade],
  exports: [SearchPublicFacade],
})
export class SearchModule {}
