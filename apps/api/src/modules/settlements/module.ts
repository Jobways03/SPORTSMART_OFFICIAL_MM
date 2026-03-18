import { Module } from '@nestjs/common';
import { SettlementsPublicFacade } from './application/facades/settlements-public.facade';

@Module({
  providers: [SettlementsPublicFacade],
  exports: [SettlementsPublicFacade],
})
export class SettlementsModule {}
