import { Module, forwardRef } from '@nestjs/common';
import { AdminCommissionController } from './presentation/controllers/admin-commission.controller';
import { SellerCommissionController } from './presentation/controllers/seller-commission.controller';
import { CommissionProcessorService } from './application/services/commission-processor.service';
import { CommissionPublicFacade } from './application/facades/commission-public.facade';
import { CommissionReversalHandler } from './application/event-handlers/commission-reversal.handler';
import { PrismaCommissionRepository } from './infrastructure/repositories/prisma-commission.repository';
import { COMMISSION_REPOSITORY } from './domain/repositories/commission.repository.interface';
import { AdminAuthGuard, SellerAuthGuard } from '../../core/guards';
import { OrdersModule } from '../orders/module';
import { MoneyModule } from '../../core/money/money.module';

@Module({
  imports: [forwardRef(() => OrdersModule), MoneyModule],
  controllers: [AdminCommissionController, SellerCommissionController],
  providers: [
    AdminAuthGuard,
    SellerAuthGuard,
    CommissionProcessorService,
    CommissionPublicFacade,
    CommissionReversalHandler,
    {
      provide: COMMISSION_REPOSITORY,
      useClass: PrismaCommissionRepository,
    },
  ],
  exports: [CommissionPublicFacade],
})
export class CommissionModule {}
