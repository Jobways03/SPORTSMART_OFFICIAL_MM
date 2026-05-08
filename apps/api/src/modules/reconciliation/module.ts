import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { ReconciliationService } from './application/services/reconciliation.service';
import { AdminReconciliationController } from './presentation/controllers/admin-reconciliation.controller';
import { WalletLedgerReconCron } from './application/jobs/wallet-ledger-recon.cron';
import { RefundGatewayReconCron } from './application/jobs/refund-gateway-recon.cron';
import { CodRefundPendingCron } from './application/jobs/cod-refund-pending.cron';

@Module({
  controllers: [AdminReconciliationController],
  providers: [
    AdminAuthGuard,
    ReconciliationService,
    // Phase 3 (PR 3.5) — recon crons. Each is independently flag-gated
    // (WALLET_LEDGER_RECON_ENABLED / REFUND_GATEWAY_RECON_ENABLED /
    // COD_REFUND_PENDING_ENABLED). All three default OFF.
    WalletLedgerReconCron,
    RefundGatewayReconCron,
    CodRefundPendingCron,
  ],
  exports: [
    ReconciliationService,
    WalletLedgerReconCron,
    RefundGatewayReconCron,
    CodRefundPendingCron,
  ],
})
export class ReconciliationModule {}
