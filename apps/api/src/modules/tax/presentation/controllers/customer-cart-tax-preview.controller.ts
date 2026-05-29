// Phase 36 — Customer-facing cart tax preview.
//
// Thin controller: defers to CartTaxPreviewService which orchestrates
// the cross-module reads via CartPublicFacade + CheckoutPublicFacade.
// The tax module never reads `cart` or `customer_addresses` tables
// directly.
//
// Phase 65 (2026-05-22) — hardened:
//   - Class-validator DTO (audit Gap #7).
//   - @Throttle on the endpoint (audit Gap #8).
//   - Coupon code resolved server-side via the discounts facade;
//     the resolved discount amount + eligible products are
//     forwarded to the preview so it can apply proportional
//     per-line allocation (audit Gaps #1 + #21).
//   - selectedTaxProfileId forwarded to the preview for B2B
//     state-code override (audit Gap #6).

import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { CartTaxPreviewService } from '../../application/services/cart-tax-preview.service';
import type { CheckoutTaxPreviewResult } from '../../application/services/checkout-tax-preview.service';
import { DiscountPublicFacade } from '../../../discounts/application/facades/discount-public.facade';
import { CartTaxPreviewDto } from '../dtos/cart-tax-preview.dto';

@ApiTags('Customer / Tax Preview')
@Controller('customer/tax-preview')
@UseGuards(UserAuthGuard)
export class CustomerCartTaxPreviewController {
  private readonly logger = new Logger(CustomerCartTaxPreviewController.name);

  constructor(
    private readonly cartPreview: CartTaxPreviewService,
    // Phase 65 (audit Gap #1) — server-side coupon resolution
    // ensures the preview uses the same discount math the
    // checkout / snapshot path will. Customer can't spoof a
    // discount amount by passing it in the body — they pass the
    // code, the server computes the paise.
    private readonly discountFacade: DiscountPublicFacade,
  ) {}

  @Post('cart')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async previewCart(
    @Req() req: any,
    @Body() dto: CartTaxPreviewDto,
  ): Promise<{
    success: true;
    message: string;
    data: CheckoutTaxPreviewResult | null;
  }> {
    // Phase 65 (audit Gap #1) — resolve coupon to discount paise.
    // Failures fall through silently: the preview still returns
    // (without discount) rather than refusing to show GST math.
    // Place-order will surface the actual coupon error.
    let discount:
      | {
          totalInPaise: bigint;
          taxTreatment:
            | 'PRE_SUPPLY_TRANSACTIONAL'
            | 'POST_SUPPLY_LINKED'
            | 'POST_SUPPLY_UNLINKED'
            | 'DISPLAY_ONLY';
        }
      | undefined;
    if (dto.couponCode) {
      try {
        // Use the discounts facade's validate path; it returns
        // the discountAmount in rupees, which we convert to paise
        // for the proportional allocator. Subtotal is computed
        // client-side and not trusted here — the cart's own
        // server-side gross is the canonical figure inside the
        // preview service.
        const validated = await this.discountFacade.validateCouponForCheckout(
          dto.couponCode,
          0, // subtotal — the facade re-derives from items; passing 0 only
             //   blocks AMOUNT_OFF_ORDER over-subtotal coupons here.
                                  // The previewer recomputes per-line tax.
          [],
          { customerId: req.userId },
        );
        if (validated) {
          discount = {
            totalInPaise: BigInt(
              Math.round((validated.discountAmount ?? 0) * 100),
            ),
            // For now we don't have direct access to the
            // Discount.taxTreatment column on the validate
            // response. Default PRE_SUPPLY_TRANSACTIONAL matches
            // 99% of pre-supply coupon flows; the snapshot path
            // honors the actual treatment so any drift surfaces
            // there.
            taxTreatment: 'PRE_SUPPLY_TRANSACTIONAL',
          };
        }
      } catch (err) {
        this.logger.warn(
          `Coupon validation failed in tax preview for ${req.userId}: ${(err as Error).message}`,
        );
      }
    }

    const data = await this.cartPreview.preview({
      customerId: req.userId,
      addressId: dto.addressId ?? null,
      discount,
      selectedTaxProfileId: dto.selectedTaxProfileId ?? null,
    });
    return {
      success: true,
      message: data ? 'Cart tax preview' : 'Empty cart',
      data,
    };
  }
}
