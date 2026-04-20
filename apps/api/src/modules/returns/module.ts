import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  FranchiseAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { FranchiseModule } from '../franchise/module';
import { RETURN_REPOSITORY } from './domain/repositories/return.repository.interface';
import { PrismaReturnRepository } from './infrastructure/repositories/prisma-return.repository';
import { ReturnService } from './application/services/return.service';
import { ReturnEligibilityService } from './application/services/return-eligibility.service';
import { ReturnAutoApprovalService } from './application/services/return-auto-approval.service';
import { ReturnStockRestorationService } from './application/services/return-stock-restoration.service';
import { ReturnCommissionReversalService } from './application/services/return-commission-reversal.service';
import { RefundGatewayService } from './application/services/refund-gateway.service';
import { RefundProcessorService } from './application/services/refund-processor.service';
import { StaleReturnProcessorService } from './application/services/stale-return-processor.service';
import { ReturnsPublicFacade } from './application/facades/returns-public.facade';
import { ReturnNotificationHandler } from './application/event-handlers/return-notification.handler';
import { CustomerReturnsController } from './presentation/controllers/customer-returns.controller';
import { AdminReturnsController } from './presentation/controllers/admin-returns.controller';
import { SellerReturnsController } from './presentation/controllers/seller-returns.controller';
import { FranchiseReturnsController } from './presentation/controllers/franchise-returns.controller';

@Module({
  imports: [FranchiseModule, RazorpayModule],
  controllers: [
    CustomerReturnsController,
    AdminReturnsController,
    SellerReturnsController,
    FranchiseReturnsController,
  ],
  providers: [
    { provide: RETURN_REPOSITORY, useClass: PrismaReturnRepository },
    ReturnService,
    ReturnEligibilityService,
    ReturnAutoApprovalService,
    ReturnStockRestorationService,
    ReturnCommissionReversalService,
    RefundGatewayService,
    RefundProcessorService,
    StaleReturnProcessorService,
    ReturnsPublicFacade,
    ReturnNotificationHandler,
    CloudinaryAdapter,
    UserAuthGuard,
    AdminAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
  ],
  exports: [ReturnsPublicFacade],
})
export class ReturnsModule {}
