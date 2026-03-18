import { Injectable } from '@nestjs/common';

@Injectable()
export class RazorpayAdapter {
  // Anti-corruption layer: all Razorpay-specific logic stays here
  // Business modules only receive normalized types
}
