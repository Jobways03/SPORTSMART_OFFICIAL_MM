import { Module } from '@nestjs/common';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { WalletController } from './presentation/controllers/wallet.controller';
import { AdminWalletController } from './presentation/controllers/admin-wallet.controller';
import { WalletService } from './application/services/wallet.service';
import { WalletPublicFacade } from './application/facades/wallet-public.facade';
// Phase 70 (2026-05-22) — Phase 66 audit Gap #8.
import { WalletRefundSagaService } from './application/services/wallet-refund-saga.service';
import { WalletRefundSagaCron } from './application/jobs/wallet-refund-saga.cron';
// Phase 172 (#9) — goodwill-expiry sweep.
import { WalletGoodwillExpiryCron } from './application/jobs/wallet-goodwill-expiry.cron';
// Phase 184 (#6) — surface an abandoned refund saga to finance as a sev-95 alert.
import { WalletRefundSagaAbandonedHandler } from './application/event-handlers/wallet-refund-saga-abandoned.handler';
import { AuditModule } from '../audit/module';
import { PrismaWalletRepository } from './infrastructure/repositories/prisma-wallet.repository';
import { WALLET_REPOSITORY } from './domain/repositories/wallet.repository.interface';

@Module({
  imports: [RazorpayModule, AuditModule],
  controllers: [WalletController, AdminWalletController],
  providers: [
    UserAuthGuard,
    AdminAuthGuard,
    WalletService,
    WalletPublicFacade,
    WalletRefundSagaService,
    WalletRefundSagaCron,
    // Phase 172 (#9) — daily goodwill-expiry sweep.
    WalletGoodwillExpiryCron,
    // Phase 184 (#6) — abandoned-refund-saga → finance alert.
    WalletRefundSagaAbandonedHandler,
    {
      provide: WALLET_REPOSITORY,
      useClass: PrismaWalletRepository,
    },
  ],
  exports: [WalletPublicFacade],
})
export class WalletModule {}
