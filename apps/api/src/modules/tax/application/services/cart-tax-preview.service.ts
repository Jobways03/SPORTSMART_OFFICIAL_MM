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
    /**
     * Phase 65 (2026-05-22) — applied-coupon discount (audit Gaps
     * #1 + #21). When supplied, the preview runs the canonical
     * allocateOrderLevel proportional split and feeds per-item
     * discount through to the tax engine so preview and snapshot
     * agree byte-for-byte.
     */
    discount?: {
      totalInPaise: bigint;
      eligibleProductIds?: ReadonlySet<string>;
      taxTreatment?:
        | 'PRE_SUPPLY_TRANSACTIONAL'
        | 'POST_SUPPLY_LINKED'
        | 'POST_SUPPLY_UNLINKED'
        | 'DISPLAY_ONLY';
    };
    /**
     * Phase 65 (audit Gap #6) — B2B GSTIN profile. When the
     * customer has chosen one for this checkout, its stateCode
     * overrides the address-derived stateCode for place-of-supply
     * resolution — mirroring the place-order flow.
     */
    selectedTaxProfileId?: string | null;
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

    // Phase 65 (audit Gap #6) — B2B GSTIN profile override. The
    // profile's stateCode wins over the address-derived stateCode
    // so the customer sees the same CGST/SGST/IGST split at
    // preview that they will at invoice time. Ownership is
    // enforced via the customerId filter — a tampered
    // selectedTaxProfileId belonging to another customer simply
    // returns null and the preview falls back to address-state.
    if (input.selectedTaxProfileId) {
      const profile = await this.prisma.customerTaxProfile.findFirst({
        where: {
          id: input.selectedTaxProfileId,
          customerId: input.customerId,
        },
        select: { stateCode: true },
      });
      if (profile && /^[0-9]{2}$/.test(profile.stateCode)) {
        customerShippingStateCode = profile.stateCode;
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
      discount: input.discount,
    });
  }
}
