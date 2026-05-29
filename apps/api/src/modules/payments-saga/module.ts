import { Global, Module } from '@nestjs/common';
import { RefundSagaService } from './application/services/refund-saga.service';
import { StuckSagaSweepCron } from './application/jobs/stuck-saga-sweep.cron';
import { StuckPendingApprovalSweepCron } from './application/jobs/stuck-pending-approval-sweep.cron';
import { AdminRefundSagasController } from './presentation/controllers/admin-refund-sagas.controller';
import { AdminAuthGuard } from '../../core/guards';
import { LiabilityLedgerModule } from '../liability-ledger/module';

/**
 * Phase 3 (PR 3.3) — Refund saga module.
 *
 * Global so refund-instruction creators (DisputeRefundHandler,
 * ReturnService.initiateRefund, manual-goodwill admin endpoints) can
 * inject the executor without explicit imports.
 *
 * Phase 1 (PR 1.5) — `StuckSagaSweepCron` now ships alongside the
 * executor so an orphan IN_PROGRESS saga never sits indefinitely.
 * Imports `LiabilityLedgerModule` to get `LiabilityLedgerPublicFacade`
 * for the admin-task enqueue side-effect.
 */
@Global()
@Module({
  imports: [LiabilityLedgerModule],
  controllers: [AdminRefundSagasController],
  providers: [
    RefundSagaService,
    StuckSagaSweepCron,
    StuckPendingApprovalSweepCron,
    AdminAuthGuard,
  ],
  exports: [RefundSagaService],
})
export class PaymentsSagaModule {}
