import { Module } from '@nestjs/common';
import { AdminOrdersController } from './presentation/controllers/admin-orders.controller';
import { AdminRoutingController } from './presentation/controllers/admin-routing.controller';
import { SellerOrdersController } from './presentation/controllers/seller-orders.controller';
import { CustomerOrdersController } from './presentation/controllers/customer-orders.controller';
import { OrdersService } from './application/services/orders.service';
import { OrderTimeoutService } from './application/services/order-timeout.service';
import { OrderAcceptanceSlaProcessor } from './application/services/order-acceptance-sla.processor';
import { RoutingHealthService } from './application/services/routing-health.service';
import { OrdersPublicFacade } from './application/facades/orders-public.facade';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { ORDER_REPOSITORY } from './domain/repositories/order.repository.interface';
import { AdminAuthGuard, SellerAuthGuard, UserAuthGuard } from '../../core/guards';
import { CatalogModule } from '../catalog/module';
import { FranchiseModule } from '../franchise/module';

@Module({
  imports: [CatalogModule, FranchiseModule],
  controllers: [AdminOrdersController, AdminRoutingController, SellerOrdersController, CustomerOrdersController],
  providers: [
    AdminAuthGuard,
    SellerAuthGuard,
    UserAuthGuard,
    OrdersService,
    OrderTimeoutService,
    OrderAcceptanceSlaProcessor,
    RoutingHealthService,
    OrdersPublicFacade,
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
  ],
  exports: [OrdersPublicFacade],
})
export class OrdersModule {}
