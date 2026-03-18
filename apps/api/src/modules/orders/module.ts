import { Module } from '@nestjs/common';
import { AdminOrdersController } from './presentation/controllers/admin-orders.controller';
import { SellerOrdersController } from './presentation/controllers/seller-orders.controller';
import { OrdersService } from './application/services/orders.service';
import { AdminAuthGuard, SellerAuthGuard } from '../../core/guards';

@Module({
  controllers: [AdminOrdersController, SellerOrdersController],
  providers: [OrdersService, AdminAuthGuard, SellerAuthGuard],
  exports: [OrdersService],
})
export class OrdersModule {}
