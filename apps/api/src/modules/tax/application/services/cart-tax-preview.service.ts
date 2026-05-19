// Phase 37 — CartTaxPreviewService.
//
// Orchestrates the cart-side tax preview consumed by the storefront's
// /cart page. The tax module stays inside its boundary by reaching for
// cross-module data only through PublicFacades:
//
//   - CartPublicFacade.getItemsForTaxPreview(customerId)
//   - CheckoutPublicFacade.getAddressForTaxPreview({ customerId, addressId })
//
// The tax engine math itself runs in CheckoutTaxPreviewService (same
// service the checkout flow uses) so the cart preview is guaranteed
// to match the checkout preview byte-for-byte.

import { Injectable } from '@nestjs/common';
import { CartPublicFacade } from '../../../cart/application/facades/cart-public.facade';
import { CheckoutPublicFacade } from '../../../checkout/application/facades/checkout-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CheckoutTaxPreviewService,
  CheckoutTaxPreviewResult,
} from './checkout-tax-preview.service';
import {
  buildStateIndex,
  extractStateCodeFromAddress,
} from '../../domain/state-code-map';

@Injectable()
export class CartTaxPreviewService {
  constructor(
    private readonly cartFacade: CartPublicFacade,
    private readonly checkoutFacade: CheckoutPublicFacade,
    private readonly taxPreview: CheckoutTaxPreviewService,
    // PrismaService is used only for tax-owned tables (india_states)
    // — the legacy state-name fallback. All cross-module reads go
    // via the facades above.
    private readonly prisma: PrismaService,
  ) {}

  async preview(input: {
    customerId: string;
    addressId?: string | null;
  }): Promise<CheckoutTaxPreviewResult | null> {
    const items = await this.cartFacade.getItemsForTaxPreview(input.customerId);
    if (items.length === 0) return null;

    const address = await this.checkoutFacade.getAddressForTaxPreview({
      customerId: input.customerId,
      addressId: input.addressId ?? null,
    });

    // Phase 34 — prefer the column-stored state code; fall back to a
    // name-lookup against india_states (tax-owned master). When the
    // address itself is missing, the engine treats it as inter-state
    // (IGST) — see CheckoutTaxPreviewService.previewForSession.
    let customerShippingStateCode: string | null = null;
    if (address) {
      if (address.stateCode && /^[0-9]{2}$/.test(address.stateCode)) {
        customerShippingStateCode = address.stateCode;
      } else if (address.state) {
        const rows = await this.prisma.indiaState.findMany({
          where: { isActive: true },
          select: { gstStateCode: true, stateName: true },
        });
        const index = buildStateIndex(rows);
        const resolved = extractStateCodeFromAddress(
          { state: address.state, stateCode: address.stateCode },
          index,
        );
        customerShippingStateCode = resolved.stateCode;
      }
    }

    return this.taxPreview.previewForSession({
      items: items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId,
        unitPriceInPaise: it.unitPriceInPaise,
        quantity: it.quantity,
        sellerId: it.sellerId,
      })),
      customerShippingStateCode,
    });
  }
}
