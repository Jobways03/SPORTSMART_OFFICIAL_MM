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
import type { Prisma } from '@prisma/client';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { Idempotent } from '../../../../../core/decorators/idempotent.decorator';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { VariantGeneratorService } from '../../../application/services/variant-generator.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
import { CartPublicFacade } from '../../../../cart/application/facades/cart-public.facade';
import { MediaStorageAdapter } from '../../../../../integrations/media/media-storage.adapter';
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
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../../domain/repositories/variant.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { StockSyncService } from '../../../application/services/stock-sync.service';

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
    private readonly stockSyncService: StockSyncService,
    private readonly media: MediaStorageAdapter,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('SellerProductVariantsController');
  }

  /**
   * Phase 42 (2026-05-21) — shared transactional core for both
   * /generate and /generate-manual. Closes audit gaps #1 (atomic
   * boundary), #4 (concurrent-generate race), #10 (mappings outside
   * outer tx).
   *
   * Steps run in one prisma.$transaction:
   *   1. SELECT … FOR UPDATE on the product row so any second
   *      concurrent /generate on the same product blocks until we
   *      commit.
   *   2. clearProductOptionsAndVariants(tx)
   *   3. createProductOption × N(tx)
   *   4. createProductOptionValue × N(tx)
   *   5. variantGenerator.generateVariants(productId, groups, tx)
   *   6. setHasVariants(productId, true, tx)
   *   7. autoCreateVariantMappings(... tx)
   *
   * Re-approval + media cleanup run AFTER commit — they're
   * either read-then-conditional-write (re-approval) or fire-and-
   * forget side effects (media).
   */
  private async runGenerateAtomically(args: {
    sellerId: string;
    productId: string;
    optionDefMap: Map<string, string[]>;
    allValueIds: string[];
    optionValueGroups: string[][];
  }): Promise<any[]> {
    const { sellerId, productId, optionDefMap, allValueIds, optionValueGroups } = args;

    return this.prisma.$transaction(async (tx) => {
      // Step 1 — row lock. SELECT FOR UPDATE blocks a concurrent
      // /generate on this same product until our tx commits, so two
      // requests can't both run the clear+rebuild interleaved.
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

      // Steps 2-4 — clear + re-create option scaffolding.
      await this.variantRepo.clearProductOptionsAndVariants(productId, tx);
      let sortOrder = 0;
      for (const defId of optionDefMap.keys()) {
        await this.variantRepo.createProductOption(productId, defId, sortOrder++, tx);
      }
      for (const valueId of allValueIds) {
        await this.variantRepo.createProductOptionValue(productId, valueId, tx);
      }

      // Step 5 — generator (shares tx; will catch P2002 → 409 itself).
      await this.variantGenerator.generateVariants(productId, optionValueGroups, tx);

      // Step 6 — flag.
      await this.variantRepo.setHasVariants(productId, true, tx);

      // Step 7 — mappings inside the same tx (Gap #10 fix).
      const variants = await tx.productVariant.findMany({
        where: { productId, isDeleted: false },
        orderBy: { sortOrder: 'asc' },
      });
      await this.autoCreateVariantMappingsTx(tx, sellerId, productId, variants);

      return variants;
    });
  }

  /**
   * Phase 41 (2026-05-21) — guard a destructive /generate run.
   *
   * The legacy behaviour was to silently hard-delete every variant +
   * option row and rebuild. One miscclick on /generate destroyed
   * SKUs, custom prices, custom images, and stock history reference
   * points. Now we:
   *
   *   1. Refuse if any variant has stock > 0 or active cart items
   *      reference any variant on this product, unless ?confirm=true.
   *   2. Capture media publicIds before clear so we can
   *      fire-and-forget delete them post-commit (Gap #16).
   *
   * Caller passes the productId and the parsed `confirm` boolean.
   * Returns the publicIds that should be deleted from media
   * after the new variants land successfully.
   */
  private async destructiveGenerateGuard(
    productId: string,
    confirm: boolean,
  ): Promise<{ publicIds: string[] }> {
    const inventory = await this.variantRepo.countActiveVariantInventory(productId);
    if ((inventory.withStock > 0 || inventory.cartItems > 0) && !confirm) {
      throw new ConflictAppException(
        `Refusing to overwrite existing variants — found ${inventory.withStock} with stock and ${inventory.cartItems} cart items. Pass ?confirm=true to proceed (this is destructive).`,
      );
    }
    const publicIds = await this.variantRepo.collectVariantImagePublicIds(productId);
    return { publicIds };
  }

  /**
   * Phase 41 — kick media deletes off the request thread. We
   * never block on these — a delete failure is acceptable (the asset
   * stays orphaned for the next sweep job).
   */
  private async cleanupmediaAssets(publicIds: string[]): Promise<void> {
    for (const id of publicIds) {
      this.media.delete(id).catch((err) =>
        this.logger.warn(`media delete failed for ${id}: ${(err as Error).message}`),
      );
    }
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

    await this.variantRepo.setHasVariants(productId, true);
    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    this.logger.log(`Variant created manually for product ${productId}`);
    return { success: true, message: 'Variant created successfully', data: variant };
  }

  @Post('generate-manual')
  @HttpCode(HttpStatus.CREATED)
  // Phase 42 (2026-05-21) — @Idempotent. Closes Gap #14. A
  // double-click during a slow network re-runs Cartesian generation
  // without; with the decorator the second hit replays the cached
  // response from the first instead of clearing + re-generating.
  @Idempotent()
  async generateManualVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query('confirm') confirm: string | undefined,
    @Body() dto: GenerateManualVariantsDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    const { publicIds } = await this.destructiveGenerateGuard(productId, confirm === 'true');

    // Resolve option name → definition.id + value strings → value.id.
    // These upserts (Phase 41) are atomic but outside the generation
    // transaction by design — option-definition + option-value rows
    // are global, not product-scoped, so re-running with the same
    // payload returns the same ids.
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
        `Generating ${cartSize} variants exceeds the per-request limit of ${VARIANT_GENERATE_MAX_COMBINATIONS}. Reduce the number of options or values per option.`,
      );
    }

    const allValueIds = optionValueIdGroups.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      const defId = ov.optionDefinitionId;
      if (!optionDefMap.has(defId)) optionDefMap.set(defId, []);
      optionDefMap.get(defId)!.push(ov.id);
    }

    const variants = await this.runGenerateAtomically({
      sellerId,
      productId,
      optionDefMap,
      allValueIds,
      optionValueGroups: optionValueIdGroups,
    });

    await this.reApprovalService.triggerIfNeeded(productId, sellerId);
    this.cleanupmediaAssets(publicIds);

    this.logger.log(`Generated ${variants.length} variants (manual options) for product ${productId}`);
    return { success: true, message: `${variants.length} variants generated successfully`, data: variants };
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  // Phase 42 — @Idempotent. Same retry-safety as /generate-manual.
  @Idempotent()
  async generateVariants(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query('confirm') confirm: string | undefined,
    @Body() dto: GenerateVariantsDto,
  ) {
    const sellerId = (req as any).sellerId;
    await this.ownershipService.validateOwnership(sellerId, productId);

    try {
      assertGenerateGroupsShape(dto.optionValueIds);
    } catch (err) {
      throw new BadRequestAppException((err as Error).message);
    }

    const cartSize = computeCartesianSize(dto.optionValueIds);
    if (cartSize > VARIANT_GENERATE_MAX_COMBINATIONS) {
      throw new BadRequestAppException(
        `Generating ${cartSize} variants exceeds the per-request limit of ${VARIANT_GENERATE_MAX_COMBINATIONS}. Reduce the number of options or values per option.`,
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
          `optionValueIds[${i}] mixes values from different option definitions — each axis must belong to one option (e.g. Color OR Size, not both).`,
        );
      }
    }

    const optionDefMap = new Map<string, string[]>();
    for (const ov of optionValues) {
      const defId = ov.optionDefinitionId;
      if (!optionDefMap.has(defId)) optionDefMap.set(defId, []);
      optionDefMap.get(defId)!.push(ov.id);
    }

    const variants = await this.runGenerateAtomically({
      sellerId,
      productId,
      optionDefMap,
      allValueIds,
      optionValueGroups: dto.optionValueIds,
    });

    await this.reApprovalService.triggerIfNeeded(productId, sellerId);
    this.cleanupmediaAssets(publicIds);

    this.logger.log(`Generated ${variants.length} variants for product ${productId}`);
    return { success: true, message: `${variants.length} variants generated successfully`, data: variants };
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

    delete (dto as any).platformPrice;
    delete (dto as any).procurementPrice;

    const variant = await this.variantRepo.findById(variantId, productId);
    if (!variant) throw new NotFoundAppException('Variant not found');

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

    // Phase 41 (2026-05-21) — Gap #10 fix. Wrap the variant update +
    // mapping sync in a single transaction with SELECT FOR UPDATE on
    // the mapping row so a concurrent checkout reservation serializes
    // against this write. Without the lock, the reservation read the
    // old mapping stock, then this update overwrote it — opening an
    // oversell window.
    const updated = await this.stockSyncService.updateVariantWithMappingSync({
      sellerId,
      productId,
      variantId,
      updateData,
      newStock: dto.stock,
    });

    // Re-approval classifier — same self-serve allowlist as before.
    await this.reApprovalService.triggerIfNeeded(productId, sellerId, {
      changedFields: Object.keys(updateData),
    });

    return { success: true, message: 'Variant updated successfully', data: updated };
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

    // Phase 41 — stock sync per row inside the transactional helper.
    for (const item of dto.variants) {
      if (item.stock !== undefined) {
        await this.stockSyncService.syncMappingStockFromVariantLocked(
          sellerId, productId, item.id, item.stock,
        );
      }
    }

    const bulkChangedFields = Array.from(
      new Set(updates.flatMap((u: any) => Object.keys(u.data || {})) as string[]),
    );
    await this.reApprovalService.triggerIfNeeded(productId, sellerId, {
      changedFields: bulkChangedFields,
    });

    return { success: true, message: `${results.length} variants updated successfully`, data: results };
  }

  /**
   * Phase 42 (2026-05-21) — tx-bound mapping creation. Closes audit
   * gap #10 — pre-Phase-42 the mapping inserts ran after the variant
   * generation transaction, so a crash between the two left the
   * seller with variants they couldn't sell.
   *
   * Doesn't swallow errors anymore — any failure propagates back to
   * the outer $transaction and rolls back the whole generation.
   * Ownership has already been validated by the caller's
   * ownershipService.validateOwnership; the redundant
   * findByIdAndSeller dead-code from the legacy helper was
   * intentionally removed (audit Section 7).
   */
  private async autoCreateVariantMappingsTx(
    tx: Prisma.TransactionClient,
    sellerId: string,
    productId: string,
    variants: any[],
  ): Promise<void> {
    // Pre-fetch the bits we need from the product row + seller
    // profile. Both reads happen inside the tx so we see consistent
    // post-clear state (the prior product-level mapping has not yet
    // been deleted at this point).
    const productBasic = await tx.product.findUnique({
      where: { id: productId },
      select: { basePrice: true },
    });
    const sellerProfile = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { storeAddress: true, sellerZipCode: true },
    });

    // Drop the now-stale product-level mapping (variantId = null)
    // before adding per-variant rows. Without this, the seller would
    // carry both shapes and queries pivoting on variantId would
    // double-count.
    await tx.sellerProductMapping.deleteMany({
      where: { sellerId, productId, variantId: null },
    });

    // De-dupe against existing variant-level mappings (a rerun on
    // the same matrix should re-use the seller's settlementPrice
    // tweaks for unchanged variants; the FK Cascade on the prior
    // variant delete already took those out, so this is mostly a
    // safety net).
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
          : productBasic?.basePrice
            ? Number(productBasic.basePrice)
            : undefined,
        pickupAddress: sellerProfile?.storeAddress || null,
        pickupPincode: sellerProfile?.sellerZipCode || null,
        dispatchSla: 2,
        approvalStatus: 'PENDING_APPROVAL' as const,
        isActive: false,
      }));

    if (toCreate.length > 0) {
      await this.sellerMappingRepo.createMany(toCreate, tx);
      this.logger.log(
        `Auto-created ${toCreate.length} seller mapping(s) for variants of product ${productId}`,
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
    if (!variant) throw new NotFoundAppException('Variant not found');

    const activeCartCount = await this.cartFacade.countActiveItemsForVariant(variantId);
    if (activeCartCount > 0) {
      throw new BadRequestAppException(
        `Cannot delete variant — ${activeCartCount} cart item(s) currently reference it. Customers must remove it from their carts first.`,
      );
    }

    await this.variantRepo.softDelete(variantId);

    const orphanedMappings = await this.sellerMappingRepo.findBySellerForProduct(sellerId, productId);
    for (const m of orphanedMappings) {
      if (m.variantId === variantId) {
        try {
          await this.sellerMappingRepo.delete(m.id);
        } catch { /* best-effort */ }
      }
    }

    await this.reApprovalService.triggerIfNeeded(productId, sellerId);

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

    return { success: true, message: 'Variant deleted successfully', data: null };
  }
}
