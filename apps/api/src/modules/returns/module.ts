import { Module } from '@nestjs/common';
import { ReturnsPublicFacade } from './application/facades/returns-public.facade';

@Module({
  providers: [ReturnsPublicFacade],
  exports: [ReturnsPublicFacade],
})
export class ReturnsModule {}
