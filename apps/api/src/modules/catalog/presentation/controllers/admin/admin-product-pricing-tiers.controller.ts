import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import {
  PricingTierWriteInput,
  ProductPricingTierService,
} from '../../../application/services/product-pricing-tier.service';

@ApiTags('Admin - Product Pricing Tiers')
@Controller({ path: 'admin/products', version: '1' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminProductPricingTiersController {
  constructor(private readonly service: ProductPricingTierService) {}

  // List every tier for a product (active + inactive), sorted by
  // minQuantity ascending. Includes inactive so ops can re-enable
  // staged tiers without recreating them.
  @Get(':productId/pricing-tiers')
  @Permissions('products.read')
  async list(@Param('productId') productId: string) {
    const data = await this.service.listForAdmin(productId);
    return { success: true, message: 'Pricing tiers', data };
  }

  @Post(':productId/pricing-tiers')
  @Permissions('catalog.write')
  async create(
    @Param('productId') productId: string,
    @Body() body: PricingTierWriteInput,
  ) {
    const data = await this.service.create(productId, body);
    return { success: true, message: 'Pricing tier created', data };
  }

  @Patch(':productId/pricing-tiers/:tierId')
  @Permissions('catalog.write')
  async update(
    @Param('productId') _productId: string,
    @Param('tierId') tierId: string,
    @Body() body: Partial<PricingTierWriteInput>,
  ) {
    const data = await this.service.update(tierId, body);
    return { success: true, message: 'Pricing tier updated', data };
  }

  @Delete(':productId/pricing-tiers/:tierId')
  @Permissions('catalog.write')
  async remove(
    @Param('productId') _productId: string,
    @Param('tierId') tierId: string,
  ) {
    const data = await this.service.remove(tierId);
    return { success: true, message: 'Pricing tier deleted', data };
  }
}
