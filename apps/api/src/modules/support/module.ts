import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  AffiliateAuthGuard,
  FranchiseAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { CustomerSupportController } from './presentation/controllers/customer-support.controller';
import { AdminSupportController } from './presentation/controllers/admin-support.controller';
import { SellerSupportController } from './presentation/controllers/seller-support.controller';
import { FranchiseSupportController } from './presentation/controllers/franchise-support.controller';
import { AffiliateSupportController } from './presentation/controllers/affiliate-support.controller';
import { SupportService } from './application/services/support.service';
import { SupportPublicFacade } from './application/facades/support-public.facade';
import { PrismaSupportRepository } from './infrastructure/repositories/prisma-support.repository';
import { SUPPORT_REPOSITORY } from './domain/repositories/support.repository.interface';

@Module({
  controllers: [
    CustomerSupportController,
    AdminSupportController,
    SellerSupportController,
    FranchiseSupportController,
    AffiliateSupportController,
  ],
  providers: [
    UserAuthGuard,
    AdminAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
    AffiliateAuthGuard,
    SupportService,
    SupportPublicFacade,
    {
      provide: SUPPORT_REPOSITORY,
      useClass: PrismaSupportRepository,
    },
  ],
  exports: [SupportPublicFacade],
})
export class SupportModule {}
