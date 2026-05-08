import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { WalletModule } from '../wallet/module';
import { LiabilityLedgerModule } from '../liability-ledger/module';
import { RefundInstructionService } from './application/services/refund-instruction.service';
import { RefundMethodSelector } from './application/services/refund-method-selector';
import { AdminRefundApprovalsController } from './presentation/controllers/admin-refund-approvals.controller';

/**
 * Phase 3 (PR 3.4) — RefundInstructions module.
 *
 * Global so any handler / use-case that mints a refund (dispute, return,
 * goodwill) can inject the service without per-module wiring.
 *
 * Imports WalletModule for the WalletPublicFacade. PaymentsSagaModule
 * is global already and provides RefundSagaService.
 *
 * Phase 3 (PR 3.6) — also exports RefundMethodSelector so callers
 * (return service, dispute decision, goodwill admin endpoint) can
 * pick the right RefundMethod deterministically.
 */
@Global()
@Module({
  imports: [WalletModule, LiabilityLedgerModule],
  controllers: [AdminRefundApprovalsController],
  providers: [RefundInstructionService, RefundMethodSelector, AdminAuthGuard],
  exports: [RefundInstructionService, RefundMethodSelector],
})
export class RefundInstructionsModule {}
