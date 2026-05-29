import { Module } from '@nestjs/common';
import { RazorpayClient } from './clients/razorpay.client';
import { RazorpayAdapter } from './adapters/razorpay.adapter';

@Module({
  providers: [RazorpayClient, RazorpayAdapter],
  // Phase 69 (2026-05-22) — Phase 66 audit Gap #9. RazorpayClient is
  // now exported so the checkout service can read the canonical key
  // id / secret without dipping into process.env.
  exports: [RazorpayAdapter, RazorpayClient],
})
export class RazorpayModule {}
