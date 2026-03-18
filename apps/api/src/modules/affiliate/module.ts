import { Module } from '@nestjs/common';
import { AffiliatePublicFacade } from './application/facades/affiliate-public.facade';

@Module({
  providers: [AffiliatePublicFacade],
  exports: [AffiliatePublicFacade],
})
export class AffiliateModule {}
