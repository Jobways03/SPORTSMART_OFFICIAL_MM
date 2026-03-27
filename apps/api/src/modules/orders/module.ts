import { Module } from '@nestjs/common';
import { AdminOrdersController } from './controllers/admin-orders.controller';
import { SellerOrdersController } from './controllers/seller-orders.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { OrdersService } from './application/services/orders.service';
import { OrderTimeoutService } from './application/services/order-timeout.service';
import { AdminAuthGuard, SellerAuthGuard, UserAuthGuard } from '../../core/guards';
import { CatalogModule } from '../catalog/module';

@Module({
  imports: [CatalogModule],
  controllers: [AdminOrdersController, SellerOrdersController, CustomerOrdersController],
  providers: [OrdersService, OrderTimeoutService, AdminAuthGuard, SellerAuthGuard, UserAuthGuard],
  exports: [OrdersService],
})
export class OrdersModule {}
