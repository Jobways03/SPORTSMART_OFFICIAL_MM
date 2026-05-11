// Cross-module surface so checkout can quote + lock a shipping option
// without importing the service directly.

import { Injectable } from '@nestjs/common';
import { ShippingOptionsService } from '../services/shipping-options.service';

@Injectable()
export class ShippingOptionsPublicFacade {
  constructor(private readonly service: ShippingOptionsService) {}

  /** Return all live options + computed fees for a given cart subtotal. */
  async quoteForCart(netCartValueInPaise: bigint) {
    return this.service.quoteForCart({ netCartValueInPaise });
  }

  /** Server-side recompute for the option the customer picked. */
  async quoteOption(args: { optionId: string; netCartValueInPaise: bigint }) {
    return this.service.quoteOption(args);
  }
}
