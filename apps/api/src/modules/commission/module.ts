import { Module } from '@nestjs/common';
import { AdminCommissionController } from './presentation/controllers/admin-commission.controller';
import { SellerCommissionController } from './presentation/controllers/seller-commission.controller';
import { CommissionProcessorService } from './application/services/commission-processor.service';
import { CommissionPublicFacade } from './application/facades/commission-public.facade';
import { PrismaCommissionRepository } from './infrastructure/repositories/prisma-commission.repository';
import { COMMISSION_REPOSITORY } from './domain/repositories/commission.repository.interface';
import { AdminAuthGuard, SellerAuthGuard } from '../../core/guards';

@Module({
  controllers: [AdminCommissionController, SellerCommissionController],
  providers: [
    AdminAuthGuard,
    SellerAuthGuard,
    CommissionProcessorService,
    CommissionPublicFacade,
    {
      provide: COMMISSION_REPOSITORY,
      useClass: PrismaCommissionRepository,
    },
  ],
  exports: [CommissionPublicFacade],
})
export class CommissionModule {}
