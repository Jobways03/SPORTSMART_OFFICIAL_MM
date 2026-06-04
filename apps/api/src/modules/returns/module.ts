import { Module, forwardRef } from '@nestjs/common';
import {
  AdminAuthGuard,
  FranchiseAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { MediaStorageAdapter } from '../../integrations/media/media-storage.adapter';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { CommissionModule } from '../commission/module';
import { FranchiseModule } from '../franchise/module';
import { WalletModule } from '../wallet/module';
import { LiabilityLedgerModule } from '../liability-ledger/module';
import { DiscountsModule } from '../discounts/discounts.module';
// TaxModule — issues credit notes (Section 34) on QC approve and the
// time-bar fallback that routes the refund through a wallet adjustment.
// Importing the module exposes CreditNoteService + WalletAdjustmentService
// for DI in ReturnService. TaxModule itself depends on WalletModule
// (already imported above) and NotificationsModule (independent), so
// no cycle.
import { TaxModule } from '../tax/module';
// Phase 92 follow-up (2026-05-23) — Gap #16 facade refactor. OrdersModule
// provides OrdersPublicFacade.getMasterOrderWithDeliveredSubOrders so the
// eligibility service no longer reaches across module boundaries to
// Prisma directly. forwardRef breaks the Orders → Returns reverse
// dependency at module-construction time.
import { OrdersModule } from '../orders/module';
import { RETURN_REPOSITORY } from './domain/repositories/return.repository.interface';
import { PrismaReturnRepository } from './infrastructure/repositories/prisma-return.repository';
import { ReturnService } from './application/services/return.service';
import { ReturnEligibilityService } from './application/services/return-eligibility.service';
import { ReturnAutoApprovalService } from './application/services/return-auto-approval.service';
import { ReturnStockRestorationService } from './application/services/return-stock-restoration.service';
import { ReturnCommissionReversalService } from './application/services/return-commission-reversal.service';
import { RefundGatewayService } from './application/services/refund-gateway.service';
import { RefundProcessorService } from './application/services/refund-processor.service';
import { RestockingFeeCalculator } from './application/services/restocking-fee.calculator';
import { CustomerAbuseCounterService } from './application/services/customer-abuse-counter.service';
import { StaleReturnProcessorService } from './application/services/stale-return-processor.service';
import { SellerResponseSweeperCron } from './application/jobs/seller-response-sweeper.cron';
// Phase 199 (2026-06-02) — Returns audit #9 orphaned-evidence cleanup
// (bounded skeleton; default-OFF, fail-closed — see the cron's doc).
import { OrphanedEvidenceCleanupCron } from './application/jobs/orphaned-evidence-cleanup.cron';
import { ReturnRiskScorerService } from './application/services/return-risk-scorer.service';
import { ReplacementOrderService } from './application/services/replacement-order.service';
import { ReturnsPublicFacade } from './application/facades/returns-public.facade';
import { ReturnNotificationHandler } from './application/event-handlers/return-notification.handler';
import { CustomerReturnsController } from './presentation/controllers/customer-returns.controller';
import { AdminReturnsController } from './presentation/controllers/admin-returns.controller';
import { SellerReturnsController } from './presentation/controllers/seller-returns.controller';
import { FranchiseReturnsController } from './presentation/controllers/franchise-returns.controller';
import { RazorpayRefundWebhookController } from './presentation/controllers/razorpay-refund-webhook.controller';
import { RazorpayRefundWebhookService } from './application/services/razorpay-refund-webhook.service';
import { RefundStatusPollerCron } from './application/jobs/refund-status-poller.cron';
import { SellerReversalService } from './application/services/seller-reversal.service';
import { SellerReversalsController } from './presentation/controllers/seller-reversals.controller';
import { AdminSellerReversalsController } from './presentation/controllers/admin-seller-reversals.controller';
import { MoneyModule } from '../../core/money/money.module';

@Module({
  imports: [
    CommissionModule,
    FranchiseModule,
    RazorpayModule,
    WalletModule,
    LiabilityLedgerModule,
    DiscountsModule,
    MoneyModule,
    // Break Tax-centric cycles (Tax → Checkout → Returns and similar).
    forwardRef(() => TaxModule),
    forwardRef(() => OrdersModule),
  ],
  controllers: [
    CustomerReturnsController,
    AdminReturnsController,
    SellerReturnsController,
    FranchiseReturnsController,
    RazorpayRefundWebhookController,
    SellerReversalsController,
    AdminSellerReversalsController,
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
    RestockingFeeCalculator,
    CustomerAbuseCounterService,
    StaleReturnProcessorService,
    SellerResponseSweeperCron,
    OrphanedEvidenceCleanupCron,
    ReturnRiskScorerService,
    ReplacementOrderService,
    ReturnsPublicFacade,
    ReturnNotificationHandler,
    MediaStorageAdapter,
    RazorpayRefundWebhookService,
    RefundStatusPollerCron,
    SellerReversalService,
    UserAuthGuard,
    AdminAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
  ],
  exports: [ReturnsPublicFacade],
})
export class ReturnsModule {}
