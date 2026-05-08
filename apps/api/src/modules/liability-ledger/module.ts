import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { AdminTaskService } from './application/services/admin-task.service';
import { LogisticsClaimService } from './application/services/logistics-claim.service';
import { PlatformExpenseService } from './application/services/platform-expense.service';
import { SellerDebitService } from './application/services/seller-debit.service';
import { LiabilityLedgerPublicFacade } from './application/facades/liability-ledger-public.facade';
import { AdminLiabilityLedgerController } from './presentation/controllers/admin-liability-ledger.controller';

/**
 * Phase 12 (post-Phase-11) — Liability ledger.
 *
 * Hosts the four append-only tables that record cost attribution for
 * customer-favoured outcomes:
 *   - SellerDebit       (recover from settlement)
 *   - LogisticsClaim    (recover from courier)
 *   - PlatformExpense   (platform absorbs)
 *   - AdminTask         (ops queue for failed automations)
 *
 * Wallet credit is NOT executed here — that's the RefundProcessor saga
 * (see docs/decisions/016-dispute-liability-ledger.md).
 */
@Module({
  controllers: [AdminLiabilityLedgerController],
  providers: [
    SellerDebitService,
    LogisticsClaimService,
    PlatformExpenseService,
    AdminTaskService,
    LiabilityLedgerPublicFacade,
    // Controller dep — needed by Nest DI when AdminLiabilityLedgerController
    // is wired alongside the existing services.
    AdminAuthGuard,
  ],
  exports: [LiabilityLedgerPublicFacade],
})
export class LiabilityLedgerModule {}
