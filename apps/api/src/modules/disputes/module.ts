import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { WalletModule } from '../wallet/module';
import { DisputeService } from './application/services/dispute.service';
import { DisputeRefundHandler } from './application/event-handlers/dispute-refund.handler';
import { CustomerDisputesController } from './presentation/controllers/customer-disputes.controller';
import { AdminDisputesController } from './presentation/controllers/admin-disputes.controller';
import { SellerDisputesController } from './presentation/controllers/seller-disputes.controller';

@Module({
  // WalletModule exports WalletPublicFacade for the refund handler.
  imports: [WalletModule],
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
    DisputeRefundHandler,
  ],
})
export class DisputesModule {}
