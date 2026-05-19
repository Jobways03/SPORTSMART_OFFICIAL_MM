import {
  Body,
  Controller,
  Delete,
  Get,
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
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { ProductSlugService } from '../../../application/services/product-slug.service';
import { ProductCodeService } from '../../../application/services/product-code.service';
import { AdminCreateProductDto } from '../../dtos/admin-create-product.dto';
import { UpdateProductDto } from '../../dtos/update-product.dto';
import { AdminRejectProductDto } from '../../dtos/admin-reject-product.dto';
import { AdminRequestChangesDto } from '../../dtos/admin-request-changes.dto';
import { AdminUpdateProductStatusDto } from '../../dtos/admin-update-status.dto';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { CartPublicFacade } from '../../../../cart/application/facades/cart-public.facade';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';

@ApiTags('Admin Products')
@Controller('admin/products')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminProductsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly slugService: ProductSlugService,
    private readonly productCodeService: ProductCodeService,
    private readonly eventBus: EventBusService,
    private readonly cartFacade: CartPublicFacade,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('AdminProductsController');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('moderationStatus') moderationStatus?: string,
    @Query('categoryId') categoryId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('hasSellers') hasSellers?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '10', 10) || 10));

    const { products, total } = await this.productRepo.findAllPaginated({
      page: pageNum, limit: limitNum, search, status, moderationStatus,
      categoryId, sellerId, hasSellers: hasSellers === 'true',
    });

    // Bulk-load franchise mappings + their stock for the page's product
    // set, so the list view can render a per-product inventory summary
    // without N+1 calls. We index by productId so the per-row .map()
    // below stays O(1).
    const productIds: string[] = (products as any[]).map((p) => p.id);
    const franchiseMappings = productIds.length
      ? await this.prisma.franchiseCatalogMapping.findMany({
          where: { productId: { in: productIds } },
          select: {
            productId: true,
            variantId: true,
            franchiseId: true,
            approvalStatus: true,
            isActive: true,
            isListedForOnlineFulfillment: true,
            franchise: { select: { status: true } },
          },
        })
      : [];
    const franchiseStock = productIds.length
      ? await this.prisma.franchiseStock.findMany({
          where: { productId: { in: productIds } },
          select: {
            productId: true,
            variantId: true,
            franchiseId: true,
            onHandQty: true,
            reservedQty: true,
            availableQty: true,
            lowStockThreshold: true,
          },
        })
      : [];

    const fmByProduct = new Map<string, typeof franchiseMappings>();
    for (const fm of franchiseMappings) {
      const arr = fmByProduct.get(fm.productId) ?? [];
      arr.push(fm);
      fmByProduct.set(fm.productId, arr);
    }
    const fsKey = (pid: string, fid: string, vid: string | null) =>
      `${pid}:${fid}:${vid ?? 'null'}`;
    const fsByKey = new Map<string, (typeof franchiseStock)[number]>();
    for (const s of franchiseStock) {
      fsByKey.set(fsKey(s.productId, s.franchiseId, s.variantId), s);
    }

    const mapped = products.map((p: any) => {
      // Seller side ── available = stockQty - reservedQty (clamp ≥ 0).
      // We reduce twice: once for "total" (sum of approved-and-not-stopped
      // stockQty, the headline number sellers usually report) and once
      // for "available" (post-reservation, what the storefront sees).
      const approvedSellerMappings = (p.sellerMappings || []).filter(
        (m: any) => m.approvalStatus === 'APPROVED' && m.isActive !== false,
      );
      const sellerTotal = approvedSellerMappings.reduce(
        (sum: number, m: any) => sum + (m.stockQty || 0),
        0,
      );
      const sellerAvailable = approvedSellerMappings.reduce(
        (sum: number, m: any) => sum + Math.max(0, (m.stockQty || 0) - (m.reservedQty || 0)),
        0,
      );
      const sellerLowStockCount = approvedSellerMappings.filter(
        (m: any) =>
          (m.stockQty || 0) - (m.reservedQty || 0) <= 5 &&
          (m.stockQty || 0) - (m.reservedQty || 0) >= 0,
      ).length;
      const sellerCount = new Set(
        approvedSellerMappings.map((m: any) => m.sellerId).filter(Boolean),
      ).size;

      // Franchise side ── only count mappings that are actually live for
      // routing: APPROVED mapping + ACTIVE/APPROVED franchise + isActive.
      // Anything else is shelf decoration and shouldn't pad the headline.
      const productMappings = fmByProduct.get(p.id) ?? [];
      const liveFranchiseMappings = productMappings.filter(
        (m) =>
          m.approvalStatus === 'APPROVED' &&
          m.isActive &&
          (m.franchise.status === 'ACTIVE' || m.franchise.status === 'APPROVED'),
      );

      let franchiseTotal = 0;
      let franchiseAvailable = 0;
      let franchiseReserved = 0;
      let franchiseLowStockCount = 0;
      const franchisesWithStock = new Set<string>();
      for (const m of liveFranchiseMappings) {
        const stock =
          fsByKey.get(fsKey(p.id, m.franchiseId, m.variantId)) ??
          // Variant-mapping with product-level stock fallback — same
          // pattern the franchise admin catalog endpoint uses.
          fsByKey.get(fsKey(p.id, m.franchiseId, null));
        if (!stock) continue;
        franchiseTotal += stock.onHandQty;
        franchiseAvailable += stock.availableQty;
        franchiseReserved += stock.reservedQty;
        if (stock.availableQty <= stock.lowStockThreshold && stock.onHandQty > 0) {
          franchiseLowStockCount++;
        }
        if (stock.onHandQty > 0) franchisesWithStock.add(m.franchiseId);
      }

      const variantStock = p.variants?.reduce(
        (sum: number, v: any) => sum + (v.stock ?? 0),
        0,
      ) ?? 0;

      // Headline `totalStock` — preserves prior semantics for callers
      // that already read this field. Prefer aggregated seller stock,
      // fall back to variant aggregate, then to product baseStock.
      const computedStock =
        sellerTotal > 0
          ? sellerTotal
          : p.hasVariants
            ? variantStock
            : (p.baseStock ?? 0);

      const totalStockAll = sellerTotal + franchiseTotal;
      const totalAvailable = sellerAvailable + franchiseAvailable;
      const totalReserved =
        approvedSellerMappings.reduce(
          (sum: number, m: any) => sum + (m.reservedQty || 0),
          0,
        ) + franchiseReserved;
      const lowStockCount = sellerLowStockCount + franchiseLowStockCount;

      return {
        ...p,
        variantCount: p._count?.variants ?? 0,
        totalStock: computedStock,
        primaryImageUrl: p.images?.[0]?.url ?? null,
        // New summary fields ── consumed by the product list page so it
        // can render an inline inventory snapshot per row without
        // making per-product API calls.
        inventorySummary: {
          totalStock: totalStockAll,
          totalAvailable,
          totalReserved,
          sellerCount,
          franchiseCount: franchisesWithStock.size,
          lowStockCount,
        },
        _count: undefined, images: undefined, variants: undefined, sellerMappings: undefined,
      };
    });

    return {
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: mapped,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      },
    };
  }

  @Get(':productId')
  @HttpCode(HttpStatus.OK)
  async getProduct(@Param('productId') productId: string) {
    const product = await this.productRepo.findByIdWithFullDetails(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    return { success: true, message: 'Product retrieved successfully', data: product };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Req() req: Request, @Body() dto: AdminCreateProductDto) {
    const adminId = (req as any).adminId;

    let seller: { id: string; status: string } | null = null;
    if (dto.sellerEmail) {
      seller = await this.productRepo.findSellerByEmail(dto.sellerEmail);
      if (!seller) throw new NotFoundAppException(`Seller with email ${dto.sellerEmail} not found`);
      if (seller.status !== 'ACTIVE') throw new AppException('Seller account is not active', 'BAD_REQUEST');
    }

    let categoryId = dto.categoryId;
    if (!categoryId && (dto as any).categoryName) {
      const category = await this.productRepo.findOrCreateCategory((dto as any).categoryName);
      categoryId = category.id;
    }

    let brandId = dto.brandId;
    if (!brandId && (dto as any).brandName) {
      const brand = await this.productRepo.findOrCreateBrand((dto as any).brandName);
      brandId = brand.id;
    }

    const slug = await this.slugService.generateUniqueSlug(dto.title);
    const productCode = await this.productCodeService.generateProductCode();

    // When admin creates a product for a seller, it goes straight to ACTIVE
    // (admin-created = pre-approved). Otherwise DRAFT for platform products.
    const initialStatus = seller ? 'ACTIVE' : 'DRAFT';

    // Stamp the tax-config audit fields if the admin supplied any
    // GST-relevant data on create. Mirrors the seller path — keeps
    // products.tax_config_updated_by/_at honest as a "who last touched
    // the tax columns" trail. Undefined-only writes (no tax fields in
    // the DTO) skip the stamp so it stays null until first set.
    const taxFieldsTouched =
      dto.hsnCode !== undefined ||
      dto.gstRateBps !== undefined ||
      dto.supplyTaxability !== undefined ||
      dto.taxInclusivePricing !== undefined ||
      dto.cessRateBps !== undefined ||
      dto.defaultUqcCode !== undefined ||
      dto.taxCategory !== undefined;

    const product = await this.productRepo.createInTransaction(
      {
        sellerId: seller?.id || null, productCode, title: dto.title, slug,
        shortDescription: dto.shortDescription, description: dto.description,
        categoryId, brandId, hasVariants: dto.hasVariants,
        status: initialStatus, moderationStatus: 'APPROVED',
        procurementPrice: dto.procurementPrice,
        basePrice: dto.basePrice, compareAtPrice: dto.compareAtPrice, costPrice: dto.costPrice,
        baseSku: dto.baseSku, baseStock: dto.baseStock,
        weight: dto.weight, weightUnit: dto.weightUnit,
        length: dto.length, width: dto.width, height: dto.height, dimensionUnit: dto.dimensionUnit,
        returnPolicy: dto.returnPolicy, warrantyInfo: dto.warrantyInfo,
        hsnCode: dto.hsnCode,
        gstRateBps: dto.gstRateBps,
        supplyTaxability: dto.supplyTaxability,
        taxInclusivePricing: dto.taxInclusivePricing,
        cessRateBps: dto.cessRateBps,
        defaultUqcCode: dto.defaultUqcCode,
        taxCategory: dto.taxCategory,
        taxConfigUpdatedBy: taxFieldsTouched ? adminId : undefined,
        taxConfigUpdatedAt: taxFieldsTouched ? new Date() : undefined,
        // Phase 37 — tax config starts unverified. Admin attests via
        // POST /admin/products/:productId/verify-tax-config after
        // review. Defaulted in schema so no explicit write needed
        // on create.
      },
      dto.tags,
      dto.seo,
      dto.variants,
      { fromStatus: null, toStatus: initialStatus, changedBy: adminId, reason: 'Product created by admin' },
    );

    this.logger.log(
      `Product created by admin ${adminId}: ${product.id}${seller ? ` for seller ${seller.id}` : ' (platform product)'}`,
    );

    // Auto-create SellerProductMapping for the assigned seller
    if (seller) {
      try {
        const sellerProfile = await this.productRepo.findSellerById(seller.id);
        const fullProduct = await this.productRepo.findFullProduct(product.id);
        const variants = fullProduct?.variants || [];

        if (variants.length > 0) {
          // Create a mapping per variant
          for (const variant of variants) {
            await this.sellerMappingRepo.create({
              sellerId: seller.id,
              productId: product.id,
              variantId: variant.id,
              stockQty: variant.stock ?? 0,
              settlementPrice: variant.price ? Number(variant.price) : (fullProduct?.basePrice ? Number(fullProduct.basePrice) : undefined),
              pickupAddress: sellerProfile?.storeAddress || null,
              pickupPincode: sellerProfile?.sellerZipCode || null,
              dispatchSla: 2,
              approvalStatus: 'APPROVED',
              isActive: true,
            });
          }
        } else {
          // Simple product — single mapping
          await this.sellerMappingRepo.create({
            sellerId: seller.id,
            productId: product.id,
            variantId: null,
            stockQty: dto.baseStock ?? 0,
            settlementPrice: dto.basePrice ? Number(dto.basePrice) : undefined,
            pickupAddress: sellerProfile?.storeAddress || null,
            pickupPincode: sellerProfile?.sellerZipCode || null,
            dispatchSla: 2,
            approvalStatus: 'APPROVED',
            isActive: true,
          });
        }

        this.logger.log(`Auto-created seller mapping(s) for admin-created product ${product.id}`);
      } catch (mappingError) {
        this.logger.warn(`Failed to auto-create seller mapping for admin product ${product.id}: ${mappingError}`);
      }
    }

    const fullProduct = await this.productRepo.findFullProduct(product.id);

    return {
      success: true,
      message: 'Product created successfully. Seller has been automatically mapped.',
      data: fullProduct,
    };
  }

  @Patch(':productId')
  @HttpCode(HttpStatus.OK)
  async updateProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    const adminId = (req as any).adminId;
    const existing = await this.productRepo.findByIdBasic(productId);
    if (!existing) throw new NotFoundAppException('Product not found');

    const updateData: any = {};
    if (dto.title !== undefined) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
    if (dto.brandId !== undefined) updateData.brandId = dto.brandId;

    if ((dto as any).categoryName !== undefined) {
      const category = await this.productRepo.findOrCreateCategory((dto as any).categoryName);
      updateData.categoryId = category.id;
    }
    if ((dto as any).brandName !== undefined) {
      const brand = await this.productRepo.findOrCreateBrand((dto as any).brandName);
      updateData.brandId = brand.id;
    }

    if (dto.shortDescription !== undefined) updateData.shortDescription = dto.shortDescription;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.hasVariants !== undefined) updateData.hasVariants = dto.hasVariants;
    if (dto.basePrice !== undefined) updateData.basePrice = dto.basePrice;
    if (dto.procurementPrice !== undefined) updateData.procurementPrice = dto.procurementPrice;
    if (dto.compareAtPrice !== undefined) updateData.compareAtPrice = dto.compareAtPrice;
    if (dto.costPrice !== undefined) updateData.costPrice = dto.costPrice;
    if (dto.baseSku !== undefined) updateData.baseSku = dto.baseSku;
    if (dto.baseBarcode !== undefined) updateData.baseBarcode = dto.baseBarcode;
    if (dto.baseStock !== undefined) updateData.baseStock = dto.baseStock;
    if (dto.weight !== undefined) updateData.weight = dto.weight;
    if (dto.weightUnit !== undefined) updateData.weightUnit = dto.weightUnit;
    if (dto.length !== undefined) updateData.length = dto.length;
    if (dto.width !== undefined) updateData.width = dto.width;
    if (dto.height !== undefined) updateData.height = dto.height;
    if (dto.dimensionUnit !== undefined) updateData.dimensionUnit = dto.dimensionUnit;
    if (dto.returnPolicy !== undefined) updateData.returnPolicy = dto.returnPolicy;
    if (dto.warrantyInfo !== undefined) updateData.warrantyInfo = dto.warrantyInfo;

    // Tax columns — forward each that was supplied, then stamp the
    // audit fields once if any of them was touched. Undefined-only
    // updates leave taxConfigUpdatedBy/_At untouched so the trail
    // reflects "who last actually changed tax data".
    if (dto.hsnCode !== undefined) updateData.hsnCode = dto.hsnCode;
    if (dto.gstRateBps !== undefined) updateData.gstRateBps = dto.gstRateBps;
    if (dto.supplyTaxability !== undefined) updateData.supplyTaxability = dto.supplyTaxability;
    if (dto.taxInclusivePricing !== undefined) updateData.taxInclusivePricing = dto.taxInclusivePricing;
    if (dto.cessRateBps !== undefined) updateData.cessRateBps = dto.cessRateBps;
    if (dto.defaultUqcCode !== undefined) updateData.defaultUqcCode = dto.defaultUqcCode;
    if (dto.taxCategory !== undefined) updateData.taxCategory = dto.taxCategory;
    const adminTaxFieldsTouched = (
      dto.hsnCode !== undefined ||
      dto.gstRateBps !== undefined ||
      dto.supplyTaxability !== undefined ||
      dto.taxInclusivePricing !== undefined ||
      dto.cessRateBps !== undefined ||
      dto.defaultUqcCode !== undefined ||
      dto.taxCategory !== undefined
    );
    if (adminTaxFieldsTouched) {
      updateData.taxConfigUpdatedBy = adminId;
      updateData.taxConfigUpdatedAt = new Date();
      // Phase 37 — touching the tax fields resets the attestation.
      // An admin editing tax config doesn't auto-attest — they
      // must follow up with POST /admin/products/:productId/
      // verify-tax-config to flip verified back to true. This
      // keeps "admin made the edit" and "admin attested the
      // config" as separate signals in the audit trail.
      updateData.taxConfigVerified = false;
      updateData.taxConfigVerifiedAt = null;
      updateData.taxConfigVerifiedBy = null;
    }

    const product = await this.productRepo.updateInTransaction(productId, updateData, dto.tags, dto.seo);
    this.logger.log(`Product ${productId} updated by admin ${adminId}`);

    const fullProduct = await this.productRepo.findFullProduct(product.id);
    return { success: true, message: 'Product updated successfully', data: fullProduct };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async deleteProduct(@Req() req: Request, @Param('productId') productId: string) {
    const adminId = (req as any).adminId;
    const existing = await this.productRepo.findByIdBasic(productId);
    if (!existing) throw new NotFoundAppException('Product not found');

    // Block deletion if any active cart references this product (either as
    // a base-product line or via any of its variants — softDeleteWithVariants
    // would orphan all of them).
    const activeCount =
      await this.cartFacade.countActiveItemsForProduct(productId);
    if (activeCount > 0) {
      throw new BadRequestAppException(
        `Cannot delete product — ${activeCount} cart item(s) currently reference it. Customers must remove it from their carts first.`,
      );
    }

    const deletedVariantIds = await this.productRepo.softDeleteWithVariants(productId);
    this.logger.log(
      `Product ${productId} deleted by admin ${adminId} (cascaded ${deletedVariantIds.length} variant(s))`,
    );

    // Emit one event per cascaded variant so the franchise module can
    // stop its mappings. Done sequentially-awaited so a mass-delete
    // doesn't create a burst of in-flight promises — but each publish
    // is wrapped so one listener failure doesn't derail the loop.
    for (const variantId of deletedVariantIds) {
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
    }

    return { success: true, message: 'Product deleted successfully', data: null };
  }

  @Patch(':productId/approve')
  @HttpCode(HttpStatus.OK)
  async approveProduct(@Req() req: Request, @Param('productId') productId: string) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    // Already active/approved — idempotent success
    if (product.status === 'ACTIVE' || product.status === 'APPROVED') {
      return { success: true, message: 'Product is already active', data: null };
    }

    const approvableStatuses = ['SUBMITTED', 'DRAFT', 'REJECTED', 'CHANGES_REQUESTED'];
    if (!approvableStatuses.includes(product.status)) {
      throw new AppException(`Cannot approve a product with status ${product.status}`, 'BAD_REQUEST');
    }

    await this.productRepo.approveInTransaction(
      productId,
      [
        { fromStatus: product.status, toStatus: 'APPROVED', changedBy: adminId, reason: 'Product approved' },
        { fromStatus: 'APPROVED', toStatus: 'ACTIVE', changedBy: adminId, reason: 'Product activated after approval' },
      ],
      { moderatorId: adminId },
    );

    this.logger.log(`Product ${productId} approved by admin ${adminId}`);

    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.approved', aggregate: 'Product', aggregateId: productId,
        occurredAt: new Date(),
        payload: { productId, productTitle: product.title, sellerId: product.sellerId, adminId },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.approved event: ${err}`);
    }

    return { success: true, message: 'Product approved and activated successfully', data: null };
  }

  // Phase 37 — admin attestation of the tax config. Separate from
  // product approval because the HSN / GST rate / supply taxability
  // review is a different competence (tax/finance team) from the
  // catalog content review (product team). The flag gates STRICT-
  // mode invoicing: TaxAuditReadinessService can be extended later
  // to flag "active products with unverified tax config" so the
  // STRICT-mode flip doesn't go live until every active product has
  // a finance signoff.
  //
  // Any subsequent edit to a tax field on the product auto-resets
  // this flag — see the admin/seller updateProduct paths.
  // Phase 37 — Bulk product tax-config update.
  //
  // Apply HSN code + GST rate + UQC + supply taxability to many
  // products in one call. Filter is either an explicit productIds list
  // OR a category match (with optional "missing HSN only" sub-filter).
  // Sets taxConfigVerified=true since an admin is explicitly attesting
  // the values.
  @Post('bulk/tax-config')
  @HttpCode(HttpStatus.OK)
  async bulkUpdateTaxConfig(
    @Req() req: Request,
    @Body()
    body: {
      productIds?: string[];
      categoryId?: string | null;
      missingHsnOnly?: boolean;
      // Tax fields to apply. At least one must be provided.
      hsnCode?: string | null;
      gstRateBps?: number;
      supplyTaxability?: string;
      defaultUqcCode?: string | null;
    },
  ) {
    const adminId = (req as any).adminId ?? 'admin';
    const hasAny =
      body.hsnCode !== undefined ||
      body.gstRateBps !== undefined ||
      body.supplyTaxability !== undefined ||
      body.defaultUqcCode !== undefined;
    if (!hasAny) {
      throw new BadRequestAppException(
        'At least one tax field (hsnCode / gstRateBps / supplyTaxability / defaultUqcCode) must be supplied',
      );
    }
    if (
      (body.productIds == null || body.productIds.length === 0) &&
      !body.categoryId
    ) {
      throw new BadRequestAppException(
        'Either productIds[] or categoryId is required',
      );
    }
    if (body.gstRateBps != null) {
      if (
        !Number.isInteger(body.gstRateBps) ||
        body.gstRateBps < 0 ||
        body.gstRateBps > 4000
      ) {
        throw new BadRequestAppException(
          'gstRateBps must be an integer between 0 and 4000',
        );
      }
    }

    // Resolve target set. Explicit IDs win; otherwise filter by
    // category + missingHsnOnly.
    const where: Record<string, unknown> = {};
    if (body.productIds && body.productIds.length > 0) {
      where.id = { in: body.productIds };
    } else if (body.categoryId) {
      where.categoryId = body.categoryId;
      if (body.missingHsnOnly) {
        where.OR = [{ hsnCode: null }, { hsnCode: '' }];
      }
    }
    const candidates = await this.prisma.product.findMany({
      where,
      select: { id: true },
      take: 2000,
    });
    if (candidates.length === 0) {
      return {
        success: true,
        message: 'No matching products',
        data: { updated: 0 },
      };
    }

    const data: Record<string, unknown> = {
      taxConfigVerified: true,
      taxConfigVerifiedAt: new Date(),
      taxConfigVerifiedBy: adminId,
      taxConfigUpdatedAt: new Date(),
      taxConfigUpdatedBy: adminId,
    };
    if (body.hsnCode !== undefined) data.hsnCode = body.hsnCode;
    if (body.gstRateBps !== undefined) data.gstRateBps = body.gstRateBps;
    if (body.supplyTaxability !== undefined)
      data.supplyTaxability = body.supplyTaxability;
    if (body.defaultUqcCode !== undefined)
      data.defaultUqcCode = body.defaultUqcCode;

    const result = await this.prisma.product.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: data as any,
    });
    this.logger.log(
      `Bulk tax-config update by admin ${adminId}: ` +
        `${result.count} products affected`,
    );
    return {
      success: true,
      message: `${result.count} product(s) updated`,
      data: { updated: result.count },
    };
  }

  @Patch(':productId/verify-tax-config')
  @HttpCode(HttpStatus.OK)
  async verifyTaxConfig(
    @Req() req: Request,
    @Param('productId') productId: string,
  ) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');

    if ((product as any).taxConfigVerified === true) {
      // Idempotent — already attested.
      return {
        success: true,
        message: 'Tax config already verified',
        data: {
          taxConfigVerified: true,
          taxConfigVerifiedAt: (product as any).taxConfigVerifiedAt,
          taxConfigVerifiedBy: (product as any).taxConfigVerifiedBy,
        },
      };
    }

    const verifiedAt = new Date();
    await this.productRepo.updateInTransaction(
      productId,
      {
        taxConfigVerified: true,
        taxConfigVerifiedAt: verifiedAt,
        taxConfigVerifiedBy: adminId,
      },
      undefined,
      undefined,
    );
    this.logger.log(
      `Product ${productId} tax config verified by admin ${adminId}`,
    );

    return {
      success: true,
      message: 'Tax config verified',
      data: {
        taxConfigVerified: true,
        taxConfigVerifiedAt: verifiedAt,
        taxConfigVerifiedBy: adminId,
      },
    };
  }

  @Patch(':productId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProduct(@Req() req: Request, @Param('productId') productId: string, @Body() dto: AdminRejectProductDto) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    const rejectableStatuses = ['SUBMITTED', 'DRAFT', 'ACTIVE', 'APPROVED'];
    if (!rejectableStatuses.includes(product.status)) {
      throw new AppException(`Cannot reject a product with status ${product.status}`, 'BAD_REQUEST');
    }

    await this.productRepo.rejectInTransaction(
      productId,
      dto.reason,
      { fromStatus: product.status, toStatus: 'REJECTED', changedBy: adminId, reason: dto.reason },
      { moderatorId: adminId },
    );

    this.logger.log(`Product ${productId} rejected by admin ${adminId}`);

    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.rejected', aggregate: 'Product', aggregateId: productId,
        occurredAt: new Date(),
        payload: { productId, productTitle: product.title, sellerId: product.sellerId, reason: dto.reason, adminId },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.rejected event: ${err}`);
    }

    return { success: true, message: 'Product rejected', data: null };
  }

  @Patch(':productId/request-changes')
  @HttpCode(HttpStatus.OK)
  async requestChanges(@Req() req: Request, @Param('productId') productId: string, @Body() dto: AdminRequestChangesDto) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    const changeableStatuses = ['SUBMITTED', 'DRAFT', 'ACTIVE', 'APPROVED'];
    if (!changeableStatuses.includes(product.status)) {
      throw new AppException(`Cannot request changes on a product with status ${product.status}`, 'BAD_REQUEST');
    }

    await this.productRepo.requestChangesInTransaction(
      productId,
      dto.note,
      { fromStatus: product.status, toStatus: 'CHANGES_REQUESTED', changedBy: adminId, reason: dto.note },
      { moderatorId: adminId },
    );

    this.logger.log(`Changes requested for product ${productId} by admin ${adminId}`);

    // Emit so the seller gets an email with the change request note. The
    // event schema matches the approved/rejected events for consistency.
    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.request_changes',
        aggregate: 'Product',
        aggregateId: productId,
        occurredAt: new Date(),
        payload: {
          productId,
          productTitle: product.title,
          sellerId: product.sellerId,
          note: dto.note,
          adminId,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.request_changes event: ${err}`);
    }

    return { success: true, message: 'Changes requested', data: null };
  }

  @Patch(':productId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(@Req() req: Request, @Param('productId') productId: string, @Body() dto: AdminUpdateProductStatusDto) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');

    const allowedTransitions: Record<string, string[]> = {
      DRAFT: ['ACTIVE', 'ARCHIVED'], SUBMITTED: ['ACTIVE', 'ARCHIVED'],
      APPROVED: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'], ACTIVE: ['SUSPENDED', 'ARCHIVED', 'DRAFT'],
      SUSPENDED: ['ACTIVE', 'ARCHIVED'], ARCHIVED: ['ACTIVE', 'DRAFT'],
      REJECTED: ['DRAFT'], CHANGES_REQUESTED: ['DRAFT'],
    };
    const allowed = allowedTransitions[product.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new AppException(`Cannot transition from ${product.status} to ${dto.status}`, 'BAD_REQUEST');
    }

    await this.productRepo.updateStatusInTransaction(productId, { status: dto.status as any }, {
      fromStatus: product.status, toStatus: dto.status, changedBy: adminId,
      reason: dto.reason || `Status changed to ${dto.status}`,
    });

    this.logger.log(`Product ${productId} status changed to ${dto.status} by admin ${adminId}`);
    return { success: true, message: `Product status updated to ${dto.status}`, data: null };
  }

  // ─────────────────────────────────────────────────────────────
  // Bulk moderation — approve / reject / request-changes for many
  // products in one request. Each item is processed independently:
  // if one product is in the wrong state we record a failure for
  // it and keep going, so a bad apple doesn't block the batch.
  // Response shape: { ok: [...productIds], failed: [{id, reason}] }
  // ─────────────────────────────────────────────────────────────

  @Post('bulk/approve')
  @HttpCode(HttpStatus.OK)
  async bulkApprove(
    @Req() req: Request,
    @Body() dto: { productIds: string[] },
  ) {
    const adminId = (req as any).adminId;
    if (!Array.isArray(dto.productIds) || dto.productIds.length === 0) {
      throw new BadRequestAppException('productIds must be a non-empty array');
    }

    const ok: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const productId of dto.productIds) {
      try {
        const product = await this.productRepo.findByIdBasic(productId);
        if (!product) {
          failed.push({ id: productId, reason: 'Product not found' });
          continue;
        }
        if (product.status !== 'SUBMITTED') {
          failed.push({
            id: productId,
            reason: `Expected SUBMITTED, got ${product.status}`,
          });
          continue;
        }
        await this.productRepo.approveInTransaction(
          productId,
          [
            { fromStatus: 'SUBMITTED', toStatus: 'APPROVED', changedBy: adminId, reason: 'Bulk approve' },
            { fromStatus: 'APPROVED', toStatus: 'ACTIVE', changedBy: adminId, reason: 'Product activated after bulk approval' },
          ],
          { moderatorId: adminId },
        );
        await this.eventBus
          .publish({
            eventName: 'catalog.listing.approved',
            aggregate: 'Product',
            aggregateId: productId,
            occurredAt: new Date(),
            payload: { productId, productTitle: product.title, sellerId: product.sellerId, adminId },
          })
          .catch(() => {});
        ok.push(productId);
      } catch (err) {
        failed.push({
          id: productId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    this.logger.log(
      `Bulk approve by admin ${adminId}: ok=${ok.length}, failed=${failed.length}`,
    );

    return {
      success: true,
      message: `Approved ${ok.length} of ${dto.productIds.length}`,
      data: { ok, failed },
    };
  }

  @Post('bulk/reject')
  @HttpCode(HttpStatus.OK)
  async bulkReject(
    @Req() req: Request,
    @Body() dto: { productIds: string[]; reason: string },
  ) {
    const adminId = (req as any).adminId;
    if (!Array.isArray(dto.productIds) || dto.productIds.length === 0) {
      throw new BadRequestAppException('productIds must be a non-empty array');
    }
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestAppException('reason is required');
    }

    const ok: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const productId of dto.productIds) {
      try {
        const product = await this.productRepo.findByIdBasic(productId);
        if (!product) {
          failed.push({ id: productId, reason: 'Product not found' });
          continue;
        }
        if (product.status !== 'SUBMITTED') {
          failed.push({
            id: productId,
            reason: `Expected SUBMITTED, got ${product.status}`,
          });
          continue;
        }
        await this.productRepo.rejectInTransaction(
          productId,
          dto.reason,
          { fromStatus: 'SUBMITTED', toStatus: 'REJECTED', changedBy: adminId, reason: dto.reason },
          { moderatorId: adminId },
        );
        await this.eventBus
          .publish({
            eventName: 'catalog.listing.rejected',
            aggregate: 'Product',
            aggregateId: productId,
            occurredAt: new Date(),
            payload: { productId, productTitle: product.title, sellerId: product.sellerId, reason: dto.reason, adminId },
          })
          .catch(() => {});
        ok.push(productId);
      } catch (err) {
        failed.push({
          id: productId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    this.logger.log(
      `Bulk reject by admin ${adminId}: ok=${ok.length}, failed=${failed.length}`,
    );

    return {
      success: true,
      message: `Rejected ${ok.length} of ${dto.productIds.length}`,
      data: { ok, failed },
    };
  }

  @Post('bulk/request-changes')
  @HttpCode(HttpStatus.OK)
  async bulkRequestChanges(
    @Req() req: Request,
    @Body() dto: { productIds: string[]; note: string },
  ) {
    const adminId = (req as any).adminId;
    if (!Array.isArray(dto.productIds) || dto.productIds.length === 0) {
      throw new BadRequestAppException('productIds must be a non-empty array');
    }
    if (!dto.note || !dto.note.trim()) {
      throw new BadRequestAppException('note is required');
    }

    const ok: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const productId of dto.productIds) {
      try {
        const product = await this.productRepo.findByIdBasic(productId);
        if (!product) {
          failed.push({ id: productId, reason: 'Product not found' });
          continue;
        }
        if (product.status !== 'SUBMITTED') {
          failed.push({
            id: productId,
            reason: `Expected SUBMITTED, got ${product.status}`,
          });
          continue;
        }
        await this.productRepo.requestChangesInTransaction(
          productId,
          dto.note,
          { fromStatus: 'SUBMITTED', toStatus: 'CHANGES_REQUESTED', changedBy: adminId, reason: dto.note },
          { moderatorId: adminId },
        );
        await this.eventBus
          .publish({
            eventName: 'catalog.listing.request_changes',
            aggregate: 'Product',
            aggregateId: productId,
            occurredAt: new Date(),
            payload: { productId, productTitle: product.title, sellerId: product.sellerId, note: dto.note, adminId },
          })
          .catch(() => {});
        ok.push(productId);
      } catch (err) {
        failed.push({
          id: productId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    this.logger.log(
      `Bulk request-changes by admin ${adminId}: ok=${ok.length}, failed=${failed.length}`,
    );

    return {
      success: true,
      message: `Changes requested on ${ok.length} of ${dto.productIds.length}`,
      data: { ok, failed },
    };
  }
}
