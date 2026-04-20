import { Module } from '@nestjs/common';
import { RazorpayClient } from './clients/razorpay.client';
import { RazorpayAdapter } from './adapters/razorpay.adapter';

@Module({
  providers: [RazorpayClient, RazorpayAdapter],
  exports: [RazorpayAdapter],
})
export class RazorpayModule {}
