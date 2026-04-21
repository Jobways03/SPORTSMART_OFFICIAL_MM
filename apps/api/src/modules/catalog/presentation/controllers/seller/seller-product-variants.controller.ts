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
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { VariantGeneratorService } from '../../../application/services/variant-generator.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
import { CartPublicFacade } from '../../../../cart/application/facades/cart-public.facade';
import { IsArray, ArrayNotEmpty } from 'class-validator';
import { UpdateVariantDto } from '../../dtos/update-variant.dto';
import { CreateVariantDto } from '../../dtos/create-variant.dto';
import { BulkUpdateVariantsDto } from '../../dtos/bulk-update-variants.dto';
import { GenerateManualVariantsDto } from '../../dtos/generate-manual-variants.dto';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../../domain/repositories/variant.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';

class GenerateVariantsDto {
  @IsArray()
  @ArrayNotEmpty()
  optionValueIds: string[][];
}

@ApiTags('Seller Products')
@Controller('seller/products/:productId/variants')
@UseGuards(SellerAuthGuard)
export class SellerProductVariantsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly variantGenerator: VariantGeneratorService,
    private readonly reApprovalService: ReApprovalService,
    private readonly cartFacade: CartPublicFacade,
    private readonly eventBus: EventBusService,
  ) {
    this.logger.setContext('SellerProductVariantsController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createVariant(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Get current max sortOrder
    const lastSortOrder = await this.variantRepo.findLastSortOrder(productId);
    const nextSort = (lastSortOrder ?? -1) + 1;

    const variant = await this.variantRepo.create({
      productId,
      title: dto.title || null,
      price: dto.price ?? 0,
      compareAtPrice: dto.compareAtPrice ?? null,
      costPrice: dto.costPrice ?? null,
      sku: dto.sku || null,
      barcode: dto.barcode || null,
      stock: dto.stock ?? 0,
      weight: dto.weight ?? null,
      weightUnit: dto.weightUnit || 'g',
      sortOrder: nextSort,
    });

    // Auto-set hasVariants = true
    await this.variantRepo.setHasVariants(productId, true);

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    this.logger.log(`Variant created manually for product ${productId}`);

    return {
      success: true,
      message: 'Variant created successfully',
      data: variant,
    };
  }

  @Post('generate-manual')
  @HttpCode(HttpStatus.CREATED)
  async generateManualVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: GenerateManualVariantsDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Step 1: Find or create OptionDefinitions and OptionValues
    const optionValueIdGroups: string[][] = [];

    for (const opt of dto.options) {
      const optName = opt.name.trim();
      if (!optName) continue;

      // Find or create OptionDefinition
      const definition = await this.variantRepo.findOrCreateOptionDefinition(optName);

      // Find or create OptionValues
      const valueIds: string[] = [];
      for (let i = 0; i < opt.values.length; i++) {
        const val = opt.values[i].trim();
        if (!val) continue;

        const optionValue = await this.variantRepo.findOrCreateOptionValue(definition.id, val, i);
        valueIds.push(optionValue.id);
      }

      if (valueIds.length > 0) {
        optionValueIdGroups.push(valueIds);
      }
    }

    if (optionValueIdGroups.length === 0) {
      return {
        success: false,
        message: 'No valid options provided',
        data: null,
      };
    }

    // Step 2: Collect all value IDs and fetch their definitions
    const allValueIds = optionValueIdGroups.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);

    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      const defId = ov.optionDefinitionId;
      if (!optionDefMap.has(defId)) {
        optionDefMap.set(defId, []);
      }
      optionDefMap.get(defId)!.push(ov.id);
    }

    // Step 3: Clear existing product options and variants, then recreate
    await this.variantRepo.clearProductOptionsAndVariants(productId);

    let sortOrder = 0;
    for (const defId of optionDefMap.keys()) {
      await this.variantRepo.createProductOption(productId, defId, sortOrder++);
    }

    for (const valueId of allValueIds) {
      await this.variantRepo.createProductOptionValue(productId, valueId);
    }

    // Step 4: Generate variants
    await this.variantGenerator.generateVariants(productId, optionValueIdGroups);

    // Step 5: Set hasVariants = true
    await this.variantRepo.setHasVariants(productId, true);

    // Step 6: Trigger re-approval
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    // Step 7: Fetch and return generated variants
    const variants = await this.variantRepo.findByProductId(productId);

    // ── Phase 11 / T3: Auto-create seller mappings for generated variants ──
    await this.autoCreateVariantMappings(sellerId, productId, variants);

    this.logger.log(
      `Generated ${variants.length} variants (manual options) for product ${productId}`,
    );

    return {
      success: true,
      message: `${variants.length} variants generated successfully`,
      data: variants,
    };
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  async generateVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: GenerateVariantsDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Collect all option value IDs
    const allValueIds = dto.optionValueIds.flat();

    // Fetch option values with their definitions to set up ProductOptions and ProductOptionValues
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);

    // Group by optionDefinition
    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      const defId = ov.optionDefinitionId;
      if (!optionDefMap.has(defId)) {
        optionDefMap.set(defId, []);
      }
      optionDefMap.get(defId)!.push(ov.id);
    }

    // Clear existing product options, option values, and variants
    await this.variantRepo.clearProductOptionsAndVariants(productId);

    // Create ProductOptions
    let sortOrder = 0;
    for (const defId of optionDefMap.keys()) {
      await this.variantRepo.createProductOption(productId, defId, sortOrder++);
    }

    // Create ProductOptionValues
    for (const valueId of allValueIds) {
      await this.variantRepo.createProductOptionValue(productId, valueId);
    }

    // Generate variants using the service
    await this.variantGenerator.generateVariants(productId, dto.optionValueIds);

    // Auto-set hasVariants = true
    await this.variantRepo.setHasVariants(productId, true);

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    // Fetch and return the generated variants
    const variants = await this.variantRepo.findByProductId(productId);

    // ── Phase 11 / T3: Auto-create seller mappings for generated variants ──
    await this.autoCreateVariantMappings(sellerId, productId, variants);

    this.logger.log(
      `Generated ${variants.length} variants for product ${productId}`,
    );

    return {
      success: true,
      message: `${variants.length} variants generated successfully`,
      data: variants,
    };
  }

  @Patch(':variantId')
  @HttpCode(HttpStatus.OK)
  async updateVariant(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Sellers cannot set admin-internal pricing (procurementPrice
    // is platform-side; platformPrice is obsolete).
    delete (dto as any).platformPrice;
    delete (dto as any).procurementPrice;

    const variant = await this.variantRepo.findById(variantId, productId);

    if (!variant) {
      throw new NotFoundAppException('Variant not found');
    }

    const updateData: any = {};
    if (dto.price !== undefined) updateData.price = dto.price;
    if (dto.compareAtPrice !== undefined) updateData.compareAtPrice = dto.compareAtPrice;
    if (dto.costPrice !== undefined) updateData.costPrice = dto.costPrice;
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

    // Price / stock / sku / status edits on an existing variant are
    // self-serve — only title / option changes force re-approval.
    await this.reApprovalService.triggerIfNeeded(productId, sellerId, {
      changedFields: Object.keys(updateData),
    });

    return {
      success: true,
      message: 'Variant updated successfully',
      data: updated,
    };
  }

  @Patch('bulk')
  @HttpCode(HttpStatus.OK)
  async bulkUpdateVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: BulkUpdateVariantsDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const updates = dto.variants.map((item) => {
      const data: any = {};
      if (item.price !== undefined) data.price = item.price;
      if (item.stock !== undefined) data.stock = item.stock;
      if (item.sku !== undefined) data.sku = item.sku;
      if (item.status !== undefined) data.status = item.status;
      return { id: item.id, data };
    });

    const results = await this.variantRepo.bulkUpdate(updates);

    // Bulk update only touches price / stock / sku / status (see the DTO
    // extraction above). All of these are on the self-serve whitelist so
    // re-approval is skipped on LIVE products.
    const bulkChangedFields = Array.from(
      new Set(
        updates.flatMap((u: any) => Object.keys(u.data || {})) as string[],
      ),
    );
    await this.reApprovalService.triggerIfNeeded(productId, sellerId, {
      changedFields: bulkChangedFields,
    });

    return {
      success: true,
      message: `${results.length} variants updated successfully`,
      data: results,
    };
  }

  // ── Phase 11 / T3: Auto-create seller mappings for generated variants ──
  private async autoCreateVariantMappings(
    sellerId: string,
    productId: string,
    variants: any[],
  ): Promise<void> {
    try {
      // Verify the product belongs to this seller (only auto-map for own products)
      const product = await this.productRepo.findByIdAndSeller(productId, sellerId);

      if (!product) {
        return; // Only auto-map for products the seller owns
      }

      const productBasic = await this.productRepo.findByIdBasic(productId);
      const sellerProfile = await this.productRepo.findSellerById(sellerId);

      // Remove existing product-level mapping (null variantId) if it exists
      await this.sellerMappingRepo.deleteBySellerProductVariantNull(sellerId, productId);

      // Get existing variant mappings for this seller + product
      const existingMappings = await this.sellerMappingRepo.findBySellerForProduct(sellerId, productId);
      const existingVariantIds = new Set(
        existingMappings.map((m: any) => m.variantId),
      );

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
            : productBasic?.basePrice
              ? Number(productBasic.basePrice)
              : undefined,
          pickupAddress: sellerProfile?.storeAddress || null,
          pickupPincode: sellerProfile?.sellerZipCode || null,
          dispatchSla: 2,
          approvalStatus: 'PENDING_APPROVAL',
          isActive: false,
        });
        created++;
      }

      if (created > 0) {
        this.logger.log(
          `Auto-created ${created} seller mapping(s) for variants of product ${productId}`,
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
  async deleteVariant(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const variant = await this.variantRepo.findById(variantId, productId);

    if (!variant) {
      throw new NotFoundAppException('Variant not found');
    }

    // Block deletion if any active cart still references this variant.
    const activeCartCount =
      await this.cartFacade.countActiveItemsForVariant(variantId);
    if (activeCartCount > 0) {
      throw new BadRequestAppException(
        `Cannot delete variant — ${activeCartCount} cart item(s) currently reference it. Customers must remove it from their carts first.`,
      );
    }

    await this.variantRepo.softDelete(variantId);

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    // Same event the admin-side variant delete emits. Franchise
    // module's VariantSoftDeleteCleanupHandler stops mappings that
    // pointed at this variant so the franchise catalog doesn't keep
    // the stale SKU in APPROVED state forever.
    try {
      await this.eventBus.publish({
        eventName: 'catalog.variant.soft_deleted',
        aggregate: 'ProductVariant',
        aggregateId: variantId,
        occurredAt: new Date(),
        payload: { variantId, productId, deletedBy: sellerId },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to publish catalog.variant.soft_deleted for ${variantId}: ${(err as Error).message}`,
      );
    }

    return {
      success: true,
      message: 'Variant deleted successfully',
      data: null,
    };
  }
}
