import { Global, Module } from '@nestjs/common';
import { RefundSagaService } from './application/services/refund-saga.service';

/**
 * Phase 3 (PR 3.3) — Refund saga module.
 *
 * Global so refund-instruction creators (DisputeRefundHandler,
 * ReturnService.initiateRefund, manual-goodwill admin endpoints) can
 * inject the executor without explicit imports.
 */
@Global()
@Module({
  providers: [RefundSagaService],
  exports: [RefundSagaService],
})
export class PaymentsSagaModule {}
