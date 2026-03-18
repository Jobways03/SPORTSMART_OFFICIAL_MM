import { Module } from '@nestjs/common';
import { ShippingPublicFacade } from './application/facades/shipping-public.facade';

@Module({
  providers: [ShippingPublicFacade],
  exports: [ShippingPublicFacade],
})
export class ShippingModule {}
