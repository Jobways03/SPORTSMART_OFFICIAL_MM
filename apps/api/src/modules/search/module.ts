import { Module } from '@nestjs/common';
import { SearchPublicFacade } from './application/facades/search-public.facade';

@Module({
  providers: [SearchPublicFacade],
  exports: [SearchPublicFacade],
})
export class SearchModule {}
