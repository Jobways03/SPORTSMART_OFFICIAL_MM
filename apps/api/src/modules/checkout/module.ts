import { Module } from '@nestjs/common';
import { CustomerAddressController } from './controllers/customer-address.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { UserAuthGuard } from '../../core/guards';

@Module({
  controllers: [CustomerAddressController, CustomerOrdersController],
  providers: [UserAuthGuard],
})
export class CheckoutModule {}
