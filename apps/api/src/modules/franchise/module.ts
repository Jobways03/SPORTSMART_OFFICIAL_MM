import { Module } from '@nestjs/common';
import { FranchisePublicFacade } from './application/facades/franchise-public.facade';

@Module({
  providers: [FranchisePublicFacade],
  exports: [FranchisePublicFacade],
})
export class FranchiseModule {}
