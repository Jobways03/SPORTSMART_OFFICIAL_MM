import { Module } from '@nestjs/common';
import { PaymentsPublicFacade } from './application/facades/payments-public.facade';

@Module({
  providers: [PaymentsPublicFacade],
  exports: [PaymentsPublicFacade],
})
export class PaymentsModule {}
