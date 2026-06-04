import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { ReconciliationService } from './application/services/reconciliation.service';
import { AdminReconciliationController } from './presentation/controllers/admin-reconciliation.controller';
import { WalletLedgerReconCron } from './application/jobs/wallet-ledger-recon.cron';
import { RefundGatewayReconCron } from './application/jobs/refund-gateway-recon.cron';
import { CodRefundPendingCron } from './application/jobs/cod-refund-pending.cron';
// Phase 168 (COD Mark-Paid audit #11) — delivered-but-uncollected COD sweep.
import { CodCollectionPendingCron } from './application/jobs/cod-collection-pending.cron';
// Phase 167 (Refund Execution audit #1) — the refund-gateway recon cron now
// actually calls Razorpay (was a stub); it needs the adapter. RefundInstruction
// service + PaymentOpsFacade are @Global, so only RazorpayModule is imported.
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
// Phase 168 (#11) — the cod-collection-pending cron enqueues AdminTasks via the
// liability-ledger facade (AdminTaskService is not @Global).
import { LiabilityLedgerModule } from '../liability-ledger/module';
// Phase 167 (#10) — consumer for refund.gateway.stuck (was unhandled).
import { RefundGatewayStuckHandler } from './application/event-handlers/refund-gateway-stuck.handler';
// Phase 173 (#11) — recon runs + transitions now write audit_logs.
import { AuditModule } from '../audit/module';
// Phase 173 (#1) — reaper that frees the (kind, period) lock if a run's worker
// crashed mid-scan.
import { ReconStaleRunReaperCron } from './application/jobs/recon-stale-run-reaper.cron';

@Module({
  imports: [RazorpayModule, LiabilityLedgerModule, AuditModule],
  controllers: [AdminReconciliationController],
  providers: [
    AdminAuthGuard,
    ReconciliationService,
    RefundGatewayStuckHandler,
    // Phase 3 (PR 3.5) — recon crons. Each is independently flag-gated
    // (WALLET_LEDGER_RECON_ENABLED / REFUND_GATEWAY_RECON_ENABLED /
    // COD_REFUND_PENDING_ENABLED / COD_COLLECTION_PENDING_ENABLED).
    WalletLedgerReconCron,
    RefundGatewayReconCron,
    CodRefundPendingCron,
    CodCollectionPendingCron,
    // Phase 173 (#1) — stale-run reaper (RECON_STALE_RUN_REAPER_ENABLED).
    ReconStaleRunReaperCron,
  ],
  exports: [
    ReconciliationService,
    WalletLedgerReconCron,
    RefundGatewayReconCron,
    CodRefundPendingCron,
    CodCollectionPendingCron,
    ReconStaleRunReaperCron,
  ],
})
export class ReconciliationModule {}
