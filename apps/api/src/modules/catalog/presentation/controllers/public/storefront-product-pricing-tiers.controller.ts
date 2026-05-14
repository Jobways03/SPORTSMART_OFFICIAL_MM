import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductPricingTierService } from '../../../application/services/product-pricing-tier.service';

/**
 * Story 3.5 — public read of active pricing tiers per product.
 *
 * Display-only at v1: the storefront uses this to render an upsell
 * ladder ("Buy 5+ save 10%") on the PDP. The cart still charges the
 * base price — this endpoint does not affect billing.
 */
@ApiTags('Storefront - Product Pricing Tiers')
@Controller({ path: 'storefront/products', version: '1' })
export class StorefrontProductPricingTiersController {
  constructor(private readonly service: ProductPricingTierService) {}

  // GET /storefront/products/:productId/pricing-tiers?variantId=...
  // Public — no auth, no permission gate. Same shape regardless of
  // who reads it. variantId is optional; when provided, the result
  // unions variant-scoped tiers with "any variant" tiers for the same
  // product.
  @Get(':productId/pricing-tiers')
  async list(
    @Param('productId') productId: string,
    @Query('variantId') variantId?: string,
  ) {
    const data = await this.service.listActiveForProduct({
      productId,
      variantId: variantId || undefined,
    });
    return { success: true, message: 'Pricing tiers', data };
  }
}
