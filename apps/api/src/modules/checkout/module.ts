import { Module } from '@nestjs/common';
import { CustomerAddressController } from './controllers/customer-address.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { CheckoutController } from './controllers/checkout.controller';
import { UserAuthGuard } from '../../core/guards';
import { CatalogModule } from '../catalog/module';

@Module({
  imports: [CatalogModule],
  controllers: [CustomerAddressController, CustomerOrdersController, CheckoutController],
  providers: [UserAuthGuard],
})
export class CheckoutModule {}
