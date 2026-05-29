import { Injectable } from '@nestjs/common';
import { CheckoutService } from '../services/checkout.service';
import { CheckoutSession } from '../services/checkout-session.service';
import { CustomerAddressService } from '../services/customer-address.service';

// Phase 37 — narrow address shape exposed for cross-module readers
// (currently the tax module's cart-side preview). Carries just what
// place-of-supply needs.
export interface AddressForTaxPreview {
  id: string;
  state: string;
  stateCode: string | null;
}

/**
 * Public facade for the Checkout module.
 * Other modules should inject this instead of reaching into internal services.
 */
@Injectable()
export class CheckoutPublicFacade {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly addresses: CustomerAddressService,
  ) {}

  /**
   * Returns the current checkout session for a customer, or null if none exists.
   */
  async getCheckoutSession(customerId: string): Promise<CheckoutSession | null> {
    return this.checkoutService.getCheckoutSession(customerId);
  }

  /**
   * Phase 37 — resolve the address the tax cart-preview should use:
   * the explicit addressId when supplied, otherwise the customer's
   * default. Returns just (state, stateCode) — the tax engine doesn't
   * need anything else for place-of-supply.
   *
   * Returns null when:
   *   - the supplied addressId doesn't belong to this customer, or
   *   - the customer has no default address yet.
   */
  async getAddressForTaxPreview(input: {
    customerId: string;
    addressId?: string | null;
  }): Promise<AddressForTaxPreview | null> {
    const list = await this.addresses.listAddresses(input.customerId);
    let picked = input.addressId
      ? list.find((a) => a.id === input.addressId) ?? null
      : null;
    if (!picked) {
      picked = list.find((a) => a.isDefault) ?? null;
    }
    if (!picked) return null;
    return {
      id: picked.id,
      state: picked.state,
      stateCode: (picked as unknown as { stateCode: string | null }).stateCode ?? null,
    };
  }
}
