import { Module } from '@nestjs/common';
import { AdminOrdersController } from './presentation/controllers/admin-orders.controller';
import { SellerOrdersController } from './presentation/controllers/seller-orders.controller';
import { CustomerOrdersController } from './presentation/controllers/customer-orders.controller';
import { OrdersService } from './application/services/orders.service';
import { OrderTimeoutService } from './application/services/order-timeout.service';
import { OrdersPublicFacade } from './application/facades/orders-public.facade';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { ORDER_REPOSITORY } from './domain/repositories/order.repository.interface';
import { AdminAuthGuard, SellerAuthGuard, UserAuthGuard } from '../../core/guards';
import { CatalogModule } from '../catalog/module';

@Module({
  imports: [CatalogModule],
  controllers: [AdminOrdersController, SellerOrdersController, CustomerOrdersController],
  providers: [
    AdminAuthGuard,
    SellerAuthGuard,
    UserAuthGuard,
    OrdersService,
    OrderTimeoutService,
    OrdersPublicFacade,
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
  ],
  exports: [OrdersPublicFacade],
})
export class OrdersModule {}
