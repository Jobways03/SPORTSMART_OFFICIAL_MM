import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { VariantGeneratorService } from '../../../application/services/variant-generator.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
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

@ApiTags('Seller Products')
@Controller('seller/products/:productId/variants')
@UseGuards(SellerAuthGuard)
export class SellerProductVariantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly variantGenerator: VariantGeneratorService,
    private readonly reApprovalService: ReApprovalService,
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
    const lastVariant = await this.prisma.productVariant.findFirst({
      where: { productId, isDeleted: false },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSort = (lastVariant?.sortOrder ?? -1) + 1;

    const variant = await this.prisma.productVariant.create({
      data: {
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
      },
      include: {
        optionValues: {
          include: {
            optionValue: {
              include: { optionDefinition: true },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    // Auto-set hasVariants = true
    await this.prisma.product.update({
      where: { id: productId },
      data: { hasVariants: true },
    });

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
      let definition = await this.prisma.optionDefinition.findUnique({
        where: { name: optName },
      });
      if (!definition) {
        definition = await this.prisma.optionDefinition.create({
          data: {
            name: optName,
            displayName: optName,
          },
        });
      }

      // Find or create OptionValues
      const valueIds: string[] = [];
      for (let i = 0; i < opt.values.length; i++) {
        const val = opt.values[i].trim();
        if (!val) continue;

        let optionValue = await this.prisma.optionValue.findUnique({
          where: {
            optionDefinitionId_value: {
              optionDefinitionId: definition.id,
              value: val,
            },
          },
        });
        if (!optionValue) {
          optionValue = await this.prisma.optionValue.create({
            data: {
              optionDefinitionId: definition.id,
              value: val,
              displayValue: val,
              sortOrder: i,
            },
          });
        }
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
    const optionValues = await this.prisma.optionValue.findMany({
      where: { id: { in: allValueIds } },
      include: { optionDefinition: true },
    });

    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      const defId = ov.optionDefinitionId;
      if (!optionDefMap.has(defId)) {
        optionDefMap.set(defId, []);
      }
      optionDefMap.get(defId)!.push(ov.id);
    }

    // Step 3: Clear existing product options and variants, then recreate
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariantOptionValue.deleteMany({
        where: { variant: { productId } },
      });
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.productOptionValue.deleteMany({ where: { productId } });
      await tx.productOption.deleteMany({ where: { productId } });

      let sortOrder = 0;
      for (const defId of optionDefMap.keys()) {
        await tx.productOption.create({
          data: {
            productId,
            optionDefinitionId: defId,
            sortOrder: sortOrder++,
          },
        });
      }

      for (const valueId of allValueIds) {
        await tx.productOptionValue.create({
          data: {
            productId,
            optionValueId: valueId,
          },
        });
      }
    });

    // Step 4: Generate variants
    await this.variantGenerator.generateVariants(productId, optionValueIdGroups);

    // Step 5: Set hasVariants = true
    await this.prisma.product.update({
      where: { id: productId },
      data: { hasVariants: true },
    });

    // Step 6: Trigger re-approval
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    // Step 7: Fetch and return generated variants
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isDeleted: false },
      include: {
        optionValues: {
          include: {
            optionValue: {
              include: { optionDefinition: true },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

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
    const optionValues = await this.prisma.optionValue.findMany({
      where: { id: { in: allValueIds } },
      include: { optionDefinition: true },
    });

    // Group by optionDefinition
    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      const defId = ov.optionDefinitionId;
      if (!optionDefMap.has(defId)) {
        optionDefMap.set(defId, []);
      }
      optionDefMap.get(defId)!.push(ov.id);
    }

    await this.prisma.$transaction(async (tx) => {
      // Clear existing product options, option values, and variants
      await tx.productVariantOptionValue.deleteMany({
        where: { variant: { productId } },
      });
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.productOptionValue.deleteMany({ where: { productId } });
      await tx.productOption.deleteMany({ where: { productId } });

      // Create ProductOptions
      let sortOrder = 0;
      for (const defId of optionDefMap.keys()) {
        await tx.productOption.create({
          data: {
            productId,
            optionDefinitionId: defId,
            sortOrder: sortOrder++,
          },
        });
      }

      // Create ProductOptionValues
      for (const valueId of allValueIds) {
        await tx.productOptionValue.create({
          data: {
            productId,
            optionValueId: valueId,
          },
        });
      }
    });

    // Generate variants using the service
    await this.variantGenerator.generateVariants(productId, dto.optionValueIds);

    // Auto-set hasVariants = true
    await this.prisma.product.update({
      where: { id: productId },
      data: { hasVariants: true },
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    // Fetch and return the generated variants
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isDeleted: false },
      include: {
        optionValues: {
          include: {
            optionValue: {
              include: { optionDefinition: true },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

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

    // Sellers CANNOT set platformPrice
    delete (dto as any).platformPrice;

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });

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

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: updateData,
      include: {
        optionValues: {
          include: {
            optionValue: {
              include: { optionDefinition: true },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

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

    const results = await this.prisma.$transaction(async (tx) => {
      const updated = [];
      for (const item of dto.variants) {
        const updateData: any = {};
        if (item.price !== undefined) updateData.price = item.price;
        if (item.stock !== undefined) updateData.stock = item.stock;
        if (item.sku !== undefined) updateData.sku = item.sku;
        if (item.status !== undefined) updateData.status = item.status;

        const variant = await tx.productVariant.update({
          where: { id: item.id },
          data: updateData,
        });
        updated.push(variant);
      }
      return updated;
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    return {
      success: true,
      message: `${results.length} variants updated successfully`,
      data: results,
    };
  }

  // ── Phase 11 / T3: Auto-create seller mappings for generated variants ──
  // When a seller generates variants for their own product, automatically
  // create SellerProductMapping entries so the product appears in the
  // storefront with seller stock/fulfillment data.
  private async autoCreateVariantMappings(
    sellerId: string,
    productId: string,
    variants: any[],
  ): Promise<void> {
    try {
      // Verify the product belongs to this seller (only auto-map for own products)
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { sellerId: true, basePrice: true },
      });

      if (!product || product.sellerId !== sellerId) {
        return; // Only auto-map for products the seller owns
      }

      const sellerProfile = await this.prisma.seller.findUnique({
        where: { id: sellerId },
        select: {
          storeAddress: true,
          sellerZipCode: true,
        },
      });

      // Remove existing product-level mapping (null variantId) if it exists,
      // since we are now creating per-variant mappings
      await this.prisma.sellerProductMapping.deleteMany({
        where: { sellerId, productId, variantId: null },
      });

      // Get existing variant mappings for this seller + product
      const existingMappings = await this.prisma.sellerProductMapping.findMany({
        where: { sellerId, productId },
        select: { variantId: true },
      });
      const existingVariantIds = new Set(
        existingMappings.map((m) => m.variantId),
      );

      let created = 0;
      for (const variant of variants) {
        if (existingVariantIds.has(variant.id)) continue; // Skip already-mapped variants

        await this.prisma.sellerProductMapping.create({
          data: {
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
            approvalStatus: 'PENDING_APPROVAL',
            isActive: false,
          },
        });
        created++;
      }

      if (created > 0) {
        this.logger.log(
          `Auto-created ${created} seller mapping(s) for variants of product ${productId}`,
        );
      }
    } catch (err) {
      // Log but don't fail variant generation if mapping creation fails
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

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });

    if (!variant) {
      throw new NotFoundAppException('Variant not found');
    }

    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    // Trigger re-approval if product was APPROVED/ACTIVE
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    return {
      success: true,
      message: 'Variant deleted successfully',
      data: null,
    };
  }
}
