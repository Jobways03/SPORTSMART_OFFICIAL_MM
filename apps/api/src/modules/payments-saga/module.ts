import { Global, Module } from '@nestjs/common';
import { RefundSagaService } from './application/services/refund-saga.service';
import { StuckSagaSweepCron } from './application/jobs/stuck-saga-sweep.cron';
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
  providers: [RefundSagaService, StuckSagaSweepCron],
  exports: [RefundSagaService],
})
export class PaymentsSagaModule {}
