import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { ProductPricingTierService } from '../../../application/services/product-pricing-tier.service';
import {
  CreatePricingTierDto,
  UpdatePricingTierDto,
} from '../../dtos/pricing-tier.dto';

/**
 * Phase 44 (2026-05-21) — seller-facing CRUD for product pricing tiers.
 *
 * Closes audit gap #4: pre-Phase-44 only admins could create / edit
 * tiers, which doesn't scale to a multi-seller marketplace. Sellers
 * can now manage tiers on their own products; ownership is enforced
 * via ProductOwnershipService (already the standard guard for seller
 * write paths on the catalog module).
 */
@ApiTags('Seller - Product Pricing Tiers')
@Controller({ path: 'seller/products', version: '1' })
@UseGuards(SellerAuthGuard)
export class SellerProductPricingTiersController {
  constructor(
    private readonly service: ProductPricingTierService,
    private readonly ownership: ProductOwnershipService,
  ) {}

  @Get(':productId/pricing-tiers')
  async list(@Req() req: Request, @Param('productId') productId: string) {
    const sellerId = (req as any).sellerId;
    await this.ownership.validateOwnership(sellerId, productId);
    const data = await this.service.listForAdmin(productId);
    return { success: true, message: 'Pricing tiers', data };
  }

  @Post(':productId/pricing-tiers')
  async create(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: CreatePricingTierDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownership.validateOwnership(sellerId, productId);
    const data = await this.service.create(productId, dto);
    return { success: true, message: 'Pricing tier created', data };
  }

  @Patch(':productId/pricing-tiers/:tierId')
  async update(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('tierId') tierId: string,
    @Body() dto: UpdatePricingTierDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownership.validateOwnership(sellerId, productId);
    const data = await this.service.update(tierId, dto);
    return { success: true, message: 'Pricing tier updated', data };
  }

  @Delete(':productId/pricing-tiers/:tierId')
  async remove(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('tierId') tierId: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownership.validateOwnership(sellerId, productId);
    const data = await this.service.remove(tierId);
    return { success: true, message: 'Pricing tier deleted', data };
  }
}
