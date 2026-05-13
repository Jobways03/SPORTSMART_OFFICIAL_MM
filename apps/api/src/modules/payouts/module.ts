import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { PayoutService } from './payout.service';
import { AdminPayoutController } from './admin-payout.controller';
import { MoneyModule } from '../../core/money/money.module';

@Module({
  imports: [MoneyModule],
  controllers: [AdminPayoutController],
  providers: [AdminAuthGuard, PayoutService],
  exports: [PayoutService],
})
export class PayoutsModule {}
