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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard, PermissionsGuard, AdminProductSellerScopeGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../../core/decorators/idempotent.decorator';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { VariantGeneratorService } from '../../../application/services/variant-generator.service';
import { StockSyncService } from '../../../application/services/stock-sync.service';
import { MediaStorageAdapter } from '../../../../../integrations/media/media-storage.adapter';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../../domain/repositories/variant.repository.interface';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { CartPublicFacade } from '../../../../cart/application/facades/cart-public.facade';
import { UpdateVariantDto } from '../../dtos/update-variant.dto';
import { CreateVariantDto } from '../../dtos/create-variant.dto';
import { BulkUpdateVariantsDto } from '../../dtos/bulk-update-variants.dto';
import { GenerateManualVariantsDto } from '../../dtos/generate-manual-variants.dto';
import {
  GenerateVariantsDto,
  VARIANT_GENERATE_MAX_COMBINATIONS,
  assertGenerateGroupsShape,
  computeCartesianSize,
} from '../../dtos/generate-variants.dto';

@ApiTags('Admin Products')
@Controller('admin/products/:productId/variants')
@UseGuards(AdminAuthGuard, PermissionsGuard, AdminProductSellerScopeGuard)
@Permissions('catalog.write')
export class AdminProductVariantsController {
  constructor(
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly variantGenerator: VariantGeneratorService,
    private readonly stockSyncService: StockSyncService,
    private readonly cartFacade: CartPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly media: MediaStorageAdapter,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('AdminProductVariantsController');
  }

  /**
   * Phase 42 (2026-05-21) — admin version of the atomic generate
   * core. Same shape as the seller controller; the only diff is the
   * mapping rows are created as APPROVED + active (admin attests on
   * behalf of the seller). Closes audit gaps #1, #4, #10 on the
   * admin path too.
   */
  private async runGenerateAtomically(args: {
    productId: string;
    optionDefMap: Map<string, string[]>;
    allValueIds: string[];
    optionValueGroups: string[][];
  }): Promise<any[]> {
    const { productId, optionDefMap, allValueIds, optionValueGroups } = args;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

      await this.variantRepo.clearProductOptionsAndVariants(productId, tx);
      let sortOrder = 0;
      for (const defId of optionDefMap.keys()) {
        await this.variantRepo.createProductOption(productId, defId, sortOrder++, tx);
      }
      for (const valueId of allValueIds) {
        await this.variantRepo.createProductOptionValue(productId, valueId, tx);
      }

      await this.variantGenerator.generateVariants(productId, optionValueGroups, tx);
      await this.variantRepo.setHasVariants(productId, true, tx);

      const variants = await tx.productVariant.findMany({
        where: { productId, isDeleted: false },
        orderBy: { sortOrder: 'asc' },
      });
      await this.autoCreateVariantMappingsForAdminTx(tx, productId, variants);

      return variants;
    });
  }

  /**
   * Phase 41 (2026-05-21) — same destructive-clear guard as the
   * seller controller. Admins can pass ?confirm=true to override.
   */
  private async destructiveGenerateGuard(productId: string, confirm: boolean) {
    const inventory = await this.variantRepo.countActiveVariantInventory(productId);
    if ((inventory.withStock > 0 || inventory.cartItems > 0) && !confirm) {
      throw new ConflictAppException(
        `Refusing to overwrite existing variants — found ${inventory.withStock} with stock and ${inventory.cartItems} cart items. Pass ?confirm=true to proceed (this is destructive).`,
      );
    }
    return { publicIds: await this.variantRepo.collectVariantImagePublicIds(productId) };
  }

  private async cleanupmediaAssets(publicIds: string[]): Promise<void> {
    for (const id of publicIds) {
      this.media.delete(id).catch((err) =>
        this.logger.warn(`media delete failed for ${id}: ${(err as Error).message}`),
      );
    }
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
  @Idempotent()
  async generateManualVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query('confirm') confirm: string | undefined,
    @Body() dto: GenerateManualVariantsDto,
  ) {
    const adminId = (req as any).adminId;
    const { publicIds } = await this.destructiveGenerateGuard(productId, confirm === 'true');

    const optionValueIdGroups: string[][] = [];
    for (const opt of dto.options) {
      const optName = opt.name.trim();
      if (!optName) continue;
      const definition = await this.variantRepo.findOrCreateOptionDefinition(optName);
      const valueIds: string[] = [];
      for (let i = 0; i < opt.values.length; i++) {
        const val = opt.values[i]!.trim();
        if (!val) continue;
        const optionValue = await this.variantRepo.findOrCreateOptionValue(definition.id, val, i);
        valueIds.push(optionValue.id);
      }
      if (valueIds.length > 0) optionValueIdGroups.push(valueIds);
    }

    if (optionValueIdGroups.length === 0) {
      return { success: false, message: 'No valid options provided', data: null };
    }

    const cartSize = computeCartesianSize(optionValueIdGroups);
    if (cartSize > VARIANT_GENERATE_MAX_COMBINATIONS) {
      throw new BadRequestAppException(
        `Generating ${cartSize} variants exceeds the per-request limit of ${VARIANT_GENERATE_MAX_COMBINATIONS}.`,
      );
    }

    const allValueIds = optionValueIdGroups.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      if (!optionDefMap.has(ov.optionDefinitionId)) optionDefMap.set(ov.optionDefinitionId, []);
      optionDefMap.get(ov.optionDefinitionId)!.push(ov.id);
    }

    const variants = await this.runGenerateAtomically({
      productId,
      optionDefMap,
      allValueIds,
      optionValueGroups: optionValueIdGroups,
    });
    this.cleanupmediaAssets(publicIds);

    this.logger.log(`Generated ${variants.length} variants (manual options) for product ${productId} by admin ${adminId}`);
    return { success: true, message: `${variants.length} variants generated successfully`, data: variants };
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  async generateVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query('confirm') confirm: string | undefined,
    @Body() dto: GenerateVariantsDto,
  ) {
    const adminId = (req as any).adminId;

    try {
      assertGenerateGroupsShape(dto.optionValueIds);
    } catch (err) {
      throw new BadRequestAppException((err as Error).message);
    }

    const cartSize = computeCartesianSize(dto.optionValueIds);
    if (cartSize > VARIANT_GENERATE_MAX_COMBINATIONS) {
      throw new BadRequestAppException(
        `Generating ${cartSize} variants exceeds the per-request limit of ${VARIANT_GENERATE_MAX_COMBINATIONS}.`,
      );
    }

    const { publicIds } = await this.destructiveGenerateGuard(productId, confirm === 'true');

    const allValueIds = dto.optionValueIds.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    if (optionValues.length !== new Set(allValueIds).size) {
      const found = new Set(optionValues.map((v: any) => v.id));
      const missing = allValueIds.filter((id) => !found.has(id));
      throw new BadRequestAppException(`Unknown option value id(s): ${missing.join(', ')}`);
    }

    const valueById = new Map(optionValues.map((v: any) => [v.id, v]));
    for (let i = 0; i < dto.optionValueIds.length; i++) {
      const axis = dto.optionValueIds[i]!;
      const defIds = new Set(axis.map((id) => valueById.get(id)?.optionDefinitionId));
      if (defIds.size !== 1) {
        throw new BadRequestAppException(
          `optionValueIds[${i}] mixes values from different option definitions.`,
        );
      }
    }

    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      if (!optionDefMap.has(ov.optionDefinitionId)) optionDefMap.set(ov.optionDefinitionId, []);
      optionDefMap.get(ov.optionDefinitionId)!.push(ov.id);
    }

    const variants = await this.runGenerateAtomically({
      productId,
      optionDefMap,
      allValueIds,
      optionValueGroups: dto.optionValueIds,
    });
    this.cleanupmediaAssets(publicIds);

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

    // Phase 41 (2026-05-21) — Gap #10 wiring on the admin path.
    // updateVariantAdmin wraps the variant write in a transaction
    // with SELECT FOR UPDATE on every mapping for this variant so
    // concurrent checkout reservations serialize against admin
    // status / price changes. Defense-in-depth — admin doesn't sync
    // mapping stock today, but the lock keeps future changes safe.
    const updated = await this.stockSyncService.updateVariantAdmin(productId, variantId, updateData);
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
   * Phase 42 (2026-05-21) — tx-bound admin mapping creation. Mirrors
   * the seller variant. Admin flow stamps APPROVED + active.
   */
  private async autoCreateVariantMappingsForAdminTx(
    tx: Prisma.TransactionClient,
    productId: string,
    variants: any[],
  ): Promise<void> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { sellerId: true, basePrice: true },
    });
    if (!product?.sellerId) return;
    const sellerId = product.sellerId;

    const sellerProfile = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { storeAddress: true, sellerZipCode: true },
    });

    await tx.sellerProductMapping.deleteMany({
      where: { sellerId, productId, variantId: null },
    });

    const existing = await tx.sellerProductMapping.findMany({
      where: { sellerId, productId },
      select: { variantId: true },
    });
    const existingVariantIds = new Set(existing.map((m: any) => m.variantId));

    const toCreate = variants
      .filter((v) => !existingVariantIds.has(v.id))
      .map((variant) => ({
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
        approvalStatus: 'APPROVED' as const,
        isActive: true,
      }));

    if (toCreate.length > 0) {
      await this.sellerMappingRepo.createMany(toCreate, tx);
      this.logger.log(
        `Auto-created ${toCreate.length} seller mapping(s) for variants of product ${productId} (admin flow)`,
      );
    }
  }

  @Delete(':variantId')
  @HttpCode(HttpStatus.OK)
  async deleteVariant(@Req() req: Request, @Param('productId') productId: string, @Param('variantId') variantId: string) {
    const adminId = (req as any).adminId;
    const variant = await this.variantRepo.findById(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');

    const activeCartCount =
      await this.cartFacade.countActiveItemsForVariant(variantId);
    if (activeCartCount > 0) {
      throw new BadRequestAppException(
        `Cannot delete variant — ${activeCartCount} cart item(s) currently reference it. Customers must remove it from their carts first.`,
      );
    }

    await this.variantRepo.softDelete(variantId);
    this.logger.log(`Variant ${variantId} deleted from product ${productId} by admin ${adminId}`);

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
