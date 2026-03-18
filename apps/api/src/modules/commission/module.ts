import { Module } from '@nestjs/common';
import { AdminCommissionController } from './controllers/admin-commission.controller';
import { SellerCommissionController } from './controllers/seller-commission.controller';
import { CommissionProcessorService } from './commission-processor.service';
import { AdminAuthGuard } from '../admin/infrastructure/guards/admin-auth.guard';
import { SellerAuthGuard } from '../seller/infrastructure/guards/seller-auth.guard';

@Module({
  controllers: [AdminCommissionController, SellerCommissionController],
  providers: [AdminAuthGuard, SellerAuthGuard, CommissionProcessorService],
})
export class CommissionModule {}
