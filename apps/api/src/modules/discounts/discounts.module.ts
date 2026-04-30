import { Module } from '@nestjs/common';
import { AdminDiscountsController } from './presentation/controllers/admin-discounts.controller';
import { CustomerDiscountsController } from './presentation/controllers/customer-discounts.controller';
import { DiscountsService } from './application/services/discounts.service';
import { DiscountPublicFacade } from './application/facades/discount-public.facade';
import { PrismaDiscountRepository } from './infrastructure/repositories/prisma-discount.repository';
import { DISCOUNT_REPOSITORY } from './domain/repositories/discount.repository.interface';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { AffiliateModule } from '../affiliate/module';

@Module({
  imports: [AffiliateModule],
  controllers: [AdminDiscountsController, CustomerDiscountsController],
  providers: [
    AdminAuthGuard,
    UserAuthGuard,
    DiscountsService,
    DiscountPublicFacade,
    {
      provide: DISCOUNT_REPOSITORY,
      useClass: PrismaDiscountRepository,
    },
  ],
  exports: [DiscountPublicFacade],
})
export class DiscountsModule {}
