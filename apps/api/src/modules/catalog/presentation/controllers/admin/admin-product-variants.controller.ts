import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';
import { VariantGeneratorService } from '../../../application/services/variant-generator.service';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../../domain/repositories/variant.repository.interface';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { CartPublicFacade } from '../../../../cart/application/facades/cart-public.facade';
import { IsArray, ArrayNotEmpty } from 'class-validator';
import { UpdateVariantDto } from '../../dtos/update-variant.dto';
import { CreateVariantDto } from '../../dtos/create-variant.dto';
import { BulkUpdateVariantsDto } from '../../dtos/bulk-update-variants.dto';
import { GenerateManualVariantsDto } from '../../dtos/generate-manual-variants.dto';

class GenerateVariantsDto {
  @IsArray()
  @ArrayNotEmpty()
  optionValueIds: string[][];
}

@ApiTags('Admin Products')
@Controller('admin/products/:productId/variants')
@UseGuards(AdminAuthGuard)
export class AdminProductVariantsController {
  constructor(
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly variantGenerator: VariantGeneratorService,
    private readonly cartFacade: CartPublicFacade,
    private readonly eventBus: EventBusService,
  ) {
    this.logger.setContext('AdminProductVariantsController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createVariant(@Req() req: Request, @Param('productId') productId: string, @Body() dto: CreateVariantDto) {
    const adminId = (req as any).adminId;
    const lastSort = await this.variantRepo.findLastSortOrder(productId);
    const nextSort = (lastSort ?? -1) + 1;

    const variant = await this.variantRepo.create({
      productId, title: dto.title || null, price: dto.price ?? 0,
      compareAtPrice: dto.compareAtPrice ?? null, costPrice: dto.costPrice ?? null,
      procurementPrice: (dto as any).procurementPrice ?? null,
      sku: dto.sku || null, barcode: dto.barcode || null, stock: dto.stock ?? 0,
      weight: dto.weight ?? null, weightUnit: dto.weightUnit || 'g', sortOrder: nextSort,
    });

    await this.variantRepo.setHasVariants(productId, true);
    this.logger.log(`Variant created manually for product ${productId} by admin ${adminId}`);
    return { success: true, message: 'Variant created successfully', data: variant };
  }

  @Post('generate-manual')
  @HttpCode(HttpStatus.CREATED)
  async generateManualVariants(@Req() req: Request, @Param('productId') productId: string, @Body() dto: GenerateManualVariantsDto) {
    const adminId = (req as any).adminId;
    const optionValueIdGroups: string[][] = [];

    for (const opt of dto.options) {
      const optName = opt.name.trim();
      if (!optName) continue;
      const definition = await this.variantRepo.findOrCreateOptionDefinition(optName);
      const valueIds: string[] = [];
      for (let i = 0; i < opt.values.length; i++) {
        const val = opt.values[i].trim();
        if (!val) continue;
        const optionValue = await this.variantRepo.findOrCreateOptionValue(definition.id, val, i);
        valueIds.push(optionValue.id);
      }
      if (valueIds.length > 0) optionValueIdGroups.push(valueIds);
    }

    if (optionValueIdGroups.length === 0) {
      return { success: false, message: 'No valid options provided', data: null };
    }

    const allValueIds = optionValueIdGroups.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      if (!optionDefMap.has(ov.optionDefinitionId)) optionDefMap.set(ov.optionDefinitionId, []);
      optionDefMap.get(ov.optionDefinitionId)!.push(ov.id);
    }

    await this.variantRepo.clearProductOptionsAndVariants(productId);
    let sortOrder = 0;
    for (const defId of optionDefMap.keys()) {
      await this.variantRepo.createProductOption(productId, defId, sortOrder++);
    }
    for (const valueId of allValueIds) {
      await this.variantRepo.createProductOptionValue(productId, valueId);
    }

    await this.variantGenerator.generateVariants(productId, optionValueIdGroups);
    await this.variantRepo.setHasVariants(productId, true);

    const variants = await this.variantRepo.findByProductId(productId);

    // Auto-create seller mappings for generated variants
    await this.autoCreateVariantMappingsForAdmin(productId, variants);

    this.logger.log(`Generated ${variants.length} variants (manual options) for product ${productId} by admin ${adminId}`);
    return { success: true, message: `${variants.length} variants generated successfully`, data: variants };
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  async generateVariants(@Req() req: Request, @Param('productId') productId: string, @Body() dto: GenerateVariantsDto) {
    const adminId = (req as any).adminId;
    const allValueIds = dto.optionValueIds.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      if (!optionDefMap.has(ov.optionDefinitionId)) optionDefMap.set(ov.optionDefinitionId, []);
      optionDefMap.get(ov.optionDefinitionId)!.push(ov.id);
    }

    await this.variantRepo.clearProductOptionsAndVariants(productId);
    let sortOrder = 0;
    for (const defId of optionDefMap.keys()) {
      await this.variantRepo.createProductOption(productId, defId, sortOrder++);
    }
    for (const valueId of allValueIds) {
      await this.variantRepo.createProductOptionValue(productId, valueId);
    }

    await this.variantGenerator.generateVariants(productId, dto.optionValueIds);
    await this.variantRepo.setHasVariants(productId, true);

    const variants = await this.variantRepo.findByProductId(productId);

    // Auto-create seller mappings for generated variants
    await this.autoCreateVariantMappingsForAdmin(productId, variants);

    this.logger.log(`Generated ${variants.length} variants for product ${productId} by admin ${adminId}`);
    return { success: true, message: `${variants.length} variants generated successfully`, data: variants };
  }

  @Patch(':variantId')
  @HttpCode(HttpStatus.OK)
  async updateVariant(@Req() req: Request, @Param('productId') productId: string, @Param('variantId') variantId: string, @Body() dto: UpdateVariantDto) {
    const adminId = (req as any).adminId;
    const variant = await this.variantRepo.findById(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');

    const updateData: any = {};
    if (dto.price !== undefined) updateData.price = dto.price;
    if (dto.compareAtPrice !== undefined) updateData.compareAtPrice = dto.compareAtPrice;
    if (dto.costPrice !== undefined) updateData.costPrice = dto.costPrice;
    if (dto.procurementPrice !== undefined) updateData.procurementPrice = dto.procurementPrice;
    if (dto.sku !== undefined) updateData.sku = dto.sku;
    if (dto.stock !== undefined) updateData.stock = dto.stock;
    if (dto.weight !== undefined) updateData.weight = dto.weight;
    if (dto.weightUnit !== undefined) updateData.weightUnit = dto.weightUnit;
    if (dto.length !== undefined) updateData.length = dto.length;
    if (dto.width !== undefined) updateData.width = dto.width;
    if (dto.height !== undefined) updateData.height = dto.height;
    if (dto.dimensionUnit !== undefined) updateData.dimensionUnit = dto.dimensionUnit;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.barcode !== undefined) updateData.barcode = dto.barcode;
    if (dto.title !== undefined) updateData.title = dto.title;

    const updated = await this.variantRepo.update(variantId, updateData);
    this.logger.log(`Variant ${variantId} updated for product ${productId} by admin ${adminId}`);
    return { success: true, message: 'Variant updated successfully', data: updated };
  }

  @Patch('bulk')
  @HttpCode(HttpStatus.OK)
  async bulkUpdateVariants(@Req() req: Request, @Param('productId') productId: string, @Body() dto: BulkUpdateVariantsDto) {
    const adminId = (req as any).adminId;
    const updates = dto.variants.map((item) => {
      const data: any = {};
      if (item.price !== undefined) data.price = item.price;
      if (item.stock !== undefined) data.stock = item.stock;
      if (item.sku !== undefined) data.sku = item.sku;
      if (item.status !== undefined) data.status = item.status;
      return { id: item.id, data };
    });
    const results = await this.variantRepo.bulkUpdate(updates);
    this.logger.log(`${results.length} variants bulk-updated for product ${productId} by admin ${adminId}`);
    return { success: true, message: `${results.length} variants updated successfully`, data: results };
  }

  /**
   * Auto-create per-variant seller mappings when admin generates variants.
   * Looks up the product's sellerId, removes stale product-level mapping,
   * and creates per-variant mappings with APPROVED status.
   */
  private async autoCreateVariantMappingsForAdmin(
    productId: string,
    variants: any[],
  ): Promise<void> {
    try {
      const product = await this.productRepo.findByIdBasic(productId);
      if (!product?.sellerId) return; // No seller associated — nothing to map

      const sellerId = product.sellerId;
      const sellerProfile = await this.productRepo.findSellerById(sellerId);

      // Remove existing product-level mapping (null variantId)
      await this.sellerMappingRepo.deleteBySellerProductVariantNull(sellerId, productId);

      // Get existing variant mappings to avoid duplicates
      const existingMappings = await this.sellerMappingRepo.findBySellerForProduct(sellerId, productId);
      const existingVariantIds = new Set(existingMappings.map((m: any) => m.variantId));

      let created = 0;
      for (const variant of variants) {
        if (existingVariantIds.has(variant.id)) continue;

        await this.sellerMappingRepo.create({
          sellerId,
          productId,
          variantId: variant.id,
          stockQty: variant.stock ?? 0,
          settlementPrice: variant.price
            ? Number(variant.price)
            : product.basePrice
              ? Number(product.basePrice)
              : undefined,
          pickupAddress: sellerProfile?.storeAddress || null,
          pickupPincode: sellerProfile?.sellerZipCode || null,
          dispatchSla: 2,
          approvalStatus: 'APPROVED',
          isActive: true,
        });
        created++;
      }

      if (created > 0) {
        this.logger.log(
          `Auto-created ${created} seller mapping(s) for variants of product ${productId} (admin flow)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to auto-create seller mappings for product ${productId}: ${err}`,
      );
    }
  }

  @Delete(':variantId')
  @HttpCode(HttpStatus.OK)
  async deleteVariant(@Req() req: Request, @Param('productId') productId: string, @Param('variantId') variantId: string) {
    const adminId = (req as any).adminId;
    const variant = await this.variantRepo.findById(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');

    // Block deletion if any active cart still references this variant.
    // Otherwise the next checkout would fetch the variant with isDeleted
    // filter, get null, and crash with a NULL reference error. Customers
    // would need manual intervention to clear their cart.
    const activeCartCount =
      await this.cartFacade.countActiveItemsForVariant(variantId);
    if (activeCartCount > 0) {
      throw new BadRequestAppException(
        `Cannot delete variant — ${activeCartCount} cart item(s) currently reference it. Customers must remove it from their carts first.`,
      );
    }

    await this.variantRepo.softDelete(variantId);
    this.logger.log(`Variant ${variantId} deleted from product ${productId} by admin ${adminId}`);

    // Notify downstream (franchise module auto-stops mappings that
    // pointed at this variant). Fire-and-forget — the repo's soft-
    // delete filter already hides dead-variant mappings, so a missed
    // event only leaves stale STOPPED-worthy rows; not a correctness
    // bug, just cleanup.
    try {
      await this.eventBus.publish({
        eventName: 'catalog.variant.soft_deleted',
        aggregate: 'ProductVariant',
        aggregateId: variantId,
        occurredAt: new Date(),
        payload: { variantId, productId, deletedBy: adminId },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to publish catalog.variant.soft_deleted for ${variantId}: ${(err as Error).message}`,
      );
    }

    return { success: true, message: 'Variant deleted successfully', data: null };
  }
}
