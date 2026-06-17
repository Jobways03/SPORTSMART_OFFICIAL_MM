import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  SellerAuthGuard,
  FranchiseAuthGuard,
} from '../../core/guards';
import { LiabilityLedgerModule } from '../liability-ledger/module';
import { RefundInstructionsModule } from '../refund-instructions/module';
import { WalletModule } from '../wallet/module';
import { DisputeService } from './application/services/dispute.service';
import { DisputeRefundRecoverySweepCron } from './application/jobs/dispute-refund-recovery-sweep.cron';
import { DisputesPublicFacade } from './application/facades/disputes-public.facade';
import { RefundRejectedDisputeHandler } from './application/event-handlers/refund-rejected-dispute.handler';
// Phase 110 (2026-05-25) — customer self-service dispute endpoints removed.
// The customer-facing dispute UI is deliberately retired (the /account/disputes
// route redirects to /account/support); disputes now reach customers only via
// admin promotion from a support ticket (promoteFromTicket). The Dispute model,
// seller filing, and admin queue remain.
import { AdminDisputesController } from './presentation/controllers/admin-disputes.controller';
import { SellerDisputesController } from './presentation/controllers/seller-disputes.controller';
import { FranchiseDisputesController } from './presentation/controllers/franchise-disputes.controller';

/**
 * Phase 12 (post-Phase-11) — refund + liability rebuild (ADR-016).
 *
 * DisputeRefundHandler is GONE. The legacy "decided event triggers
 * wallet credit" path is replaced by DisputeService.decide creating a
 * RefundInstruction inline (saga executes wallet credit) plus writing
 * the right liability-ledger row. WalletPublicFacade is no longer
 * imported here — a static check we lean on to keep the boundary
 * honest.
 *
 * WalletModule kept in imports only because some controllers may
 * still surface wallet-related read fields on dispute detail; if and
 * when we audit those usages we can drop this too.
 */
@Module({
  imports: [
    WalletModule,
    RefundInstructionsModule,
    LiabilityLedgerModule,
  ],
  controllers: [
    AdminDisputesController,
    SellerDisputesController,
    FranchiseDisputesController,
  ],
  providers: [
    AdminAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
    DisputeService,
    DisputeRefundRecoverySweepCron,
    DisputesPublicFacade,
    RefundRejectedDisputeHandler,
  ],
  exports: [DisputesPublicFacade],
})
export class DisputesModule {}
