import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { LiabilityLedgerModule } from '../liability-ledger/module';
import { RefundInstructionsModule } from '../refund-instructions/module';
import { WalletModule } from '../wallet/module';
import { DisputeService } from './application/services/dispute.service';
import { DisputesPublicFacade } from './application/facades/disputes-public.facade';
import { CustomerDisputesController } from './presentation/controllers/customer-disputes.controller';
import { AdminDisputesController } from './presentation/controllers/admin-disputes.controller';
import { SellerDisputesController } from './presentation/controllers/seller-disputes.controller';

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
    CustomerDisputesController,
    AdminDisputesController,
    SellerDisputesController,
  ],
  providers: [
    UserAuthGuard,
    AdminAuthGuard,
    SellerAuthGuard,
    DisputeService,
    DisputesPublicFacade,
  ],
  exports: [DisputesPublicFacade],
})
export class DisputesModule {}
