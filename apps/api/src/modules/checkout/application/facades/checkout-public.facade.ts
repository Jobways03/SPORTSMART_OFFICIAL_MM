import { Injectable } from '@nestjs/common';
import { CheckoutService } from '../services/checkout.service';
import { CheckoutSession } from '../services/checkout-session.service';

/**
 * Public facade for the Checkout module.
 * Other modules should inject this instead of reaching into internal services.
 */
@Injectable()
export class CheckoutPublicFacade {
  constructor(private readonly checkoutService: CheckoutService) {}

  /**
   * Returns the current checkout session for a customer, or null if none exists.
   */
  async getCheckoutSession(customerId: string): Promise<CheckoutSession | null> {
    return this.checkoutService.getCheckoutSession(customerId);
  }
}
