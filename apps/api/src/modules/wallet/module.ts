import { Module } from '@nestjs/common';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { WalletController } from './presentation/controllers/wallet.controller';
import { AdminWalletController } from './presentation/controllers/admin-wallet.controller';
import { WalletService } from './application/services/wallet.service';
import { WalletPublicFacade } from './application/facades/wallet-public.facade';
import { PrismaWalletRepository } from './infrastructure/repositories/prisma-wallet.repository';
import { WALLET_REPOSITORY } from './domain/repositories/wallet.repository.interface';

@Module({
  imports: [RazorpayModule],
  controllers: [WalletController, AdminWalletController],
  providers: [
    UserAuthGuard,
    AdminAuthGuard,
    WalletService,
    WalletPublicFacade,
    {
      provide: WALLET_REPOSITORY,
      useClass: PrismaWalletRepository,
    },
  ],
  exports: [WalletPublicFacade],
})
export class WalletModule {}
