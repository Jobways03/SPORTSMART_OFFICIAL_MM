import { Module } from '@nestjs/common';
import { AdminControlTowerPublicFacade } from './application/facades/admin-control-tower-public.facade';

@Module({
  providers: [AdminControlTowerPublicFacade],
  exports: [AdminControlTowerPublicFacade],
})
export class AdminControlTowerModule {}
