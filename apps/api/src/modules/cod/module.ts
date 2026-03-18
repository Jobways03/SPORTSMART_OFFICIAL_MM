import { Module } from '@nestjs/common';
import { CodPublicFacade } from './application/facades/cod-public.facade';

@Module({
  providers: [CodPublicFacade],
  exports: [CodPublicFacade],
})
export class CodModule {}
