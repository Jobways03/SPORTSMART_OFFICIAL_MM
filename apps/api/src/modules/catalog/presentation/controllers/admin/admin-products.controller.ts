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
import { AdminAuthGuard, PermissionsGuard, RolesGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { Roles } from '../../../../../core/decorators/roles.decorator';
import { Idempotent } from '../../../../../core/decorators/idempotent.decorator';
import { CurrentAdmin } from '../../../../../core/decorators/current-actor.decorator';
import { ProductSlugService } from '../../../application/services/product-slug.service';
import { ProductCodeService } from '../../../application/services/product-code.service';
// Phase 39 (2026-05-21) — required-metafield gate on approve.
import { MetafieldValidationService } from '../../../application/services/metafield-validation.service';
// Phase 45 (2026-05-21) — atomic tax-config attestation w/ audit log.
import { ProductTaxAttestationService } from '../../../application/services/product-tax-attestation.service';
import {
  BULK_TAX_CONFIG_MAX_PRODUCTS,
  BulkUpdateTaxConfigDto,
  BulkVerifyTaxConfigDto,
  VerifyTaxConfigDto,
} from '../../dtos/tax-config.dto';
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
// Phase 46 (2026-05-21) — RolesGuard added at the class level so the
// @Roles() decorator on the bulk tax-config endpoints fires its
// belt-and-braces hard-role check (defence-in-depth alongside the
// tax.bulk-config / tax.bulk-verify permission keys). RolesGuard
// short-circuits to allow when no @Roles() metadata is set, so the
// other handlers on this controller are unaffected.
@UseGuards(AdminAuthGuard, PermissionsGuard, RolesGuard)
export class AdminProductsController {
  /**
   * Phase 31 (2026-05-21) — states in which a product is still part
   * of the moderation pipeline. /reject, /request-changes, and the
   * bulk variants accept this set. SUBMITTED is the standard case;
   * DRAFT / REJECTED / CHANGES_REQUESTED let an admin pre-emptively
   * stamp a verdict on rows that haven't been submitted, or re-stamp
   * after the seller pulled back. ACTIVE / APPROVED are deliberately
   * NOT here — taking down a live product must go through
   * PATCH /:id/status (SUSPENDED/ARCHIVED) so the takedown reason is
   * captured in the status-change history and the storefront cache
   * invalidation hooks fire for the correct transition.
   */
  private static readonly MODERATION_REVIEW_STATES: readonly string[] = [
    'SUBMITTED',
    'DRAFT',
    'REJECTED',
    'CHANGES_REQUESTED',
  ];

  /**
   * Phase 31 (2026-05-21) — same set + cap for bulk endpoints. Pre-
   * Phase-31 bulk hard-required SUBMITTED while single accepted more
   * states; the asymmetry was confusing.
   */
  private static readonly BULK_MAX_BATCH = 200;

  // Phase 29 (2026-05-21) — granular @Permissions per method.
  // Pre-Phase-29 the controller carried a single class-level
  // `catalog.write` that gated reads *and* moderation behind the same
  // role grant. Now: `catalog.read` for GETs, `catalog.write` for the
  // CRUD body, `catalog.approve` for moderation + tax attestation +
  // bulk ops. The PermissionsGuard merges class- and method-level
  // metadata, so each handler advertises its own permission below.
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly slugService: ProductSlugService,
    private readonly productCodeService: ProductCodeService,
    private readonly eventBus: EventBusService,
    private readonly cartFacade: CartPublicFacade,
    private readonly prisma: PrismaService,
    private readonly metafieldValidation: MetafieldValidationService,
    private readonly taxAttestation: ProductTaxAttestationService,
  ) {
    this.logger.setContext('AdminProductsController');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
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
  @Permissions('catalog.read')
  async getProduct(@Param('productId') productId: string) {
    const product = await this.productRepo.findByIdWithFullDetails(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    return { success: true, message: 'Product retrieved successfully', data: product };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  // Phase 32 (2026-05-21) — admin create supports X-Idempotency-Key.
  // Mirrors the seller create path; a double-click on the admin
  // form returns the same product instead of creating a duplicate.
  @Idempotent()
  async createProduct(@CurrentAdmin() adminId: string, @Body() dto: AdminCreateProductDto) {

    let seller: { id: string; status: string } | null = null;
    if (dto.sellerEmail) {
      seller = await this.productRepo.findSellerByEmail(dto.sellerEmail);
      if (!seller) throw new NotFoundAppException(`Seller with email ${dto.sellerEmail} not found`);
      if (seller.status !== 'ACTIVE') throw new AppException('Seller account is not active', 'BAD_REQUEST');
    }

    // Phase 29 (2026-05-21) — taxonomy must be referenced by uuid.
    // The pre-Phase-29 path accepted `categoryName` / `brandName` and
    // called findOrCreateCategory/Brand, which (a) had no @Permissions
    // gate on taxonomy creation, (b) silently created duplicate rows
    // for case-variant typos ("Shoe" vs "Shoes"), (c) blew up on
    // slug collisions with a Prisma P2002 500. Admins now create
    // taxonomy via the dedicated /admin/categories + /admin/brands
    // endpoints and reference the resulting uuid.
    const categoryId = dto.categoryId;
    const brandId = dto.brandId;

    const slug = await this.slugService.generateUniqueSlug(dto.title);
    const productCode = await this.productCodeService.generateProductCode();

    // Phase 29 (2026-05-21) — products ALWAYS start in DRAFT regardless
    // of seller assignment. The pre-Phase-29 short-circuit
    // (`seller ? 'ACTIVE' : 'DRAFT'`) bypassed moderation and let
    // admins publish unreviewed products straight to ACTIVE with
    // moderationStatus=APPROVED. Activation now requires an explicit
    // POST /admin/products/:productId/approve call, which runs the
    // publish-readiness check (category/brand/price/image/tax) added
    // alongside this change.
    const initialStatus = 'DRAFT';

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
        // Phase 29 (2026-05-21) — both status + moderationStatus start
        // PENDING / DRAFT. The pre-Phase-29 unconditional
        // moderationStatus=APPROVED stamp was the second half of the
        // DRAFT-skip bug (the first half being status=ACTIVE).
        status: initialStatus, moderationStatus: 'PENDING',
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

    // Phase 249 (#4) — stamp AI provenance + flip the log to ACCEPTED
    // now the product row exists. Best-effort; never blocks the create.
    await this.stampAiProvenance(product.id, dto.aiGenerationLogId);

    // Auto-create SellerProductMapping for the assigned seller.
    //
    // Phase 29 (2026-05-21) — mappings start PENDING + isActive=false.
    // The pre-Phase-29 APPROVED+isActive stamp was the third half of
    // the DRAFT-skip bug: even after the product is forced to DRAFT,
    // an APPROVED mapping would be picked up by the routing engine as
    // soon as the product is later approved. PENDING + isActive=false
    // forces an explicit per-seller approval step.
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
              approvalStatus: 'PENDING',
              isActive: false,
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
            approvalStatus: 'PENDING',
            isActive: false,
          });
        }

        this.logger.log(`Auto-created PENDING seller mapping(s) for admin-created product ${product.id}`);
      } catch (mappingError) {
        this.logger.warn(`Failed to auto-create seller mapping for admin product ${product.id}: ${mappingError}`);
      }
    }

    const fullProduct = await this.productRepo.findFullProduct(product.id);

    return {
      success: true,
      message: seller
        ? 'Product created as DRAFT. Seller mapping is PENDING and must be approved via /admin/products/:productId/approve.'
        : 'Product created as DRAFT. Use /admin/products/:productId/approve to publish.',
      data: fullProduct,
    };
  }

  @Patch(':productId')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async updateProduct(
    @CurrentAdmin() adminId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    const existing = await this.productRepo.findByIdBasic(productId);
    if (!existing) throw new NotFoundAppException('Product not found');

    // Phase 249 (#4) — stamp AI provenance + flip the log to ACCEPTED.
    // Independent of the field-diff below so it records even on an
    // otherwise no-op PATCH that only re-asserts the AI draft. CAS on
    // the log makes a repeat save a no-op on the log row. Best-effort.
    await this.stampAiProvenance(productId, dto.aiGenerationLogId);

    const updateData: any = {};
    if (dto.title !== undefined) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
    if (dto.brandId !== undefined) updateData.brandId = dto.brandId;

    // Phase 29 (2026-05-21) — categoryName / brandName free-form
    // assignment removed (see /create). Admins must reference uuid.

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
    // Phase 92 follow-up (2026-05-23) — Gap #22 admin surface for the
    // typed return-policy columns. Each is optional; only forward
    // explicitly-supplied values.
    if (dto.isReturnable !== undefined) updateData.isReturnable = dto.isReturnable;
    if (dto.nonReturnableReason !== undefined) {
      updateData.nonReturnableReason = dto.nonReturnableReason || null;
    }
    if (dto.returnWindowDaysOverride !== undefined) {
      updateData.returnWindowDaysOverride = dto.returnWindowDaysOverride;
    }
    if (dto.allowedReturnReasons !== undefined) {
      updateData.allowedReturnReasonsJson =
        dto.allowedReturnReasons.length > 0
          ? (dto.allowedReturnReasons as any)
          : null;
    }
    if (dto.allowPartialReturn !== undefined) {
      updateData.allowPartialReturn = dto.allowPartialReturn;
    }

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
      // Phase 45 (2026-05-21) — bump the monotonic version so any
      // open admin attest screen sees the drift.
      updateData.taxConfigVersion = { increment: 1 };
    }

    const product = await this.productRepo.updateInTransaction(productId, updateData, dto.tags, dto.seo);
    this.logger.log(`Product ${productId} updated by admin ${adminId}`);

    // Phase 45 (2026-05-21) — append-only audit row. Fire-and-forget
    // so an audit-log failure doesn't roll back the primary update;
    // the source of truth is the Product row, the log is the mirror.
    if (adminTaxFieldsTouched) {
      this.taxAttestation
        .recordEdited({
          productId,
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'EDITED',
        })
        .catch((err) =>
          this.logger.warn(
            `Failed to write tax-attestation audit row for ${productId}: ${err}`,
          ),
        );
    }

    const fullProduct = await this.productRepo.findFullProduct(product.id);
    return { success: true, message: 'Product updated successfully', data: fullProduct };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async deleteProduct(@CurrentAdmin() adminId: string, @Param('productId') productId: string) {
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
  @Permissions('catalog.approve')
  async approveProduct(@CurrentAdmin() adminId: string, @Param('productId') productId: string) {
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

    // Phase 39 (2026-05-21) — required category metafield gate on
    // approve. The repository's approveInTransaction enforces the
    // Phase 29 publish-readiness check (brand, category, basePrice,
    // image) but doesn't reach into the metafield table. Catch the
    // missing-required-metafield case here so the admin sees a
    // single 400 with the field list rather than approving a row
    // that then renders as "incomplete" on the storefront.
    const mfCheck = await this.metafieldValidation.validateRequiredOnSubmit(
      productId,
      product.categoryId ?? null,
    );
    if (mfCheck.missing.length > 0) {
      throw new BadRequestAppException(
        `Cannot approve — missing required metafields: ${mfCheck.missing
          .map((m) => m.name || m.key)
          .join(', ')}`,
      );
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
  // Phase 46 (2026-05-21) — dedicated SUPER_ADMIN-only perm key.
  // Pre-Phase-46 the endpoint used `catalog.approve` which is shared
  // with regular catalog operations; any catalog-approver admin
  // could rewrite tax data across thousands of products. The new key
  // `tax.bulk-config` is intentionally absent from every non-
  // SUPER_ADMIN role's permission set, so SUPER_ADMIN's
  // ALL_PERMISSION_KEYS catch-all is the only path to it.
  //
  // @Roles('SUPER_ADMIN') is belt-and-braces — protects against a
  // future role definition accidentally including the permission
  // key. Either guard alone rejects non-SUPER_ADMIN admins.
  @Permissions('tax.bulk-config')
  @Roles('SUPER_ADMIN')
  @Idempotent()
  async bulkUpdateTaxConfig(
    @CurrentAdmin() adminId: string,
    @Body() dto: BulkUpdateTaxConfigDto,
  ) {
    const hasAny =
      dto.hsnCode !== undefined ||
      dto.gstRateBps !== undefined ||
      dto.cessRateBps !== undefined ||
      dto.supplyTaxability !== undefined ||
      dto.defaultUqcCode !== undefined;
    if (!hasAny) {
      throw new BadRequestAppException(
        'At least one tax field (hsnCode / gstRateBps / cessRateBps / supplyTaxability / defaultUqcCode) must be supplied',
      );
    }
    if ((dto.productIds == null || dto.productIds.length === 0) && !dto.categoryId) {
      throw new BadRequestAppException('Either productIds[] or categoryId is required');
    }

    // Phase 46 (2026-05-21) — Gaps #11 + #13 + #14.
    //
    //   #11 silent truncation: the pre-Phase-46 path did findMany with
    //       take: 2000 then updateMany on whatever came back. A
    //       category matching 5000 products silently dropped 3000.
    //       Now the candidate query has no `take`; if the result is
    //       larger than the per-call cap we 400 with a helpful
    //       message + ask the admin to narrow the filter.
    //   #13 race window: candidate findMany + product update + audit
    //       log all run inside one $transaction with row locks on
    //       the candidate set, so a concurrent product write can't
    //       drift the set between the read and the writes.
    //   #14 status filter: candidate query now filters
    //       isDeleted=false. Bulk tax-config write on a soft-deleted
    //       row is meaningless work + would stamp the attestation
    //       columns on a dead product.
    const baseWhere: Record<string, unknown> = { isDeleted: false };
    if (dto.productIds && dto.productIds.length > 0) {
      baseWhere.id = { in: dto.productIds };
    } else if (dto.categoryId) {
      baseWhere.categoryId = dto.categoryId;
      if (dto.missingHsnOnly) {
        baseWhere.OR = [{ hsnCode: null }, { hsnCode: '' }];
      }
    }

    const updateData: Record<string, unknown> = {
      taxConfigVerified: false,
      taxConfigVerifiedAt: null,
      taxConfigVerifiedBy: null,
      taxConfigUpdatedAt: new Date(),
      taxConfigUpdatedBy: adminId,
      taxConfigVersion: { increment: 1 },
    };
    if (dto.hsnCode !== undefined) updateData.hsnCode = dto.hsnCode;
    if (dto.gstRateBps !== undefined) updateData.gstRateBps = dto.gstRateBps;
    if (dto.cessRateBps !== undefined) updateData.cessRateBps = dto.cessRateBps;
    if (dto.supplyTaxability !== undefined) updateData.supplyTaxability = dto.supplyTaxability;
    if (dto.defaultUqcCode !== undefined) updateData.defaultUqcCode = dto.defaultUqcCode;

    const { updated } = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.product.findMany({
        where: baseWhere,
        select: { id: true },
      });
      if (candidates.length === 0) {
        return { updated: 0 };
      }
      if (candidates.length > BULK_TAX_CONFIG_MAX_PRODUCTS) {
        throw new BadRequestAppException(
          `Filter matches ${candidates.length} products which exceeds the per-call cap of ${BULK_TAX_CONFIG_MAX_PRODUCTS}. Narrow the filter (e.g. supply explicit productIds[], or use missingHsnOnly).`,
        );
      }
      const candidateIds = candidates.map((c) => c.id);
      // Row-level lock on every candidate so a concurrent product
      // write (seller edit, single-product PATCH) serializes against
      // us for the duration of the bulk write + audit log emit.
      await tx.$queryRaw`
        SELECT id FROM products WHERE id = ANY(${candidateIds}::text[]) FOR UPDATE
      `;
      await tx.product.updateMany({
        where: { id: { in: candidateIds } },
        data: updateData as any,
      });
      await this.taxAttestation.recordBulkEdited({
        tx,
        productIds: candidateIds,
        actorId: adminId,
        actorRole: 'ADMIN',
      });
      return { updated: candidateIds.length };
    });

    this.logger.log(
      `Bulk tax-config update by admin ${adminId}: ` +
        `${updated} products affected (attestation reset; verify-tax-config required per product)`,
    );
    return {
      success: true,
      message:
        `${updated} product(s) updated. ` +
        `taxConfigVerified has been reset — each product requires a follow-up ` +
        `POST /admin/products/:productId/verify-tax-config attestation.`,
      data: { updated },
    };
  }

  /**
   * Phase 46 (2026-05-21) — preview endpoint for the bulk-tax-config
   * page. Returns the match count + a sample of products so the UI
   * can render a confirmation modal ("About to update X products.
   * Examples: ...") before the admin commits.
   *
   * Same filter shape as the write endpoint; never mutates.
   */
  @Post('bulk/tax-config/preview')
  @HttpCode(HttpStatus.OK)
  // Phase 46 — same gates as the write endpoint. Preview is read-
  // only but it answers "how many products match my filter", which
  // is also a recon signal we don't want to expose broadly.
  @Permissions('tax.bulk-config')
  @Roles('SUPER_ADMIN')
  async previewBulkTaxConfig(@Body() dto: BulkUpdateTaxConfigDto) {
    if ((dto.productIds == null || dto.productIds.length === 0) && !dto.categoryId) {
      throw new BadRequestAppException('Either productIds[] or categoryId is required');
    }

    const baseWhere: Record<string, unknown> = { isDeleted: false };
    if (dto.productIds && dto.productIds.length > 0) {
      baseWhere.id = { in: dto.productIds };
    } else if (dto.categoryId) {
      baseWhere.categoryId = dto.categoryId;
      if (dto.missingHsnOnly) {
        baseWhere.OR = [{ hsnCode: null }, { hsnCode: '' }];
      }
    }

    const [count, sample] = await Promise.all([
      this.prisma.product.count({ where: baseWhere }),
      this.prisma.product.findMany({
        where: baseWhere,
        select: {
          id: true,
          title: true,
          hsnCode: true,
          gstRateBps: true,
          supplyTaxability: true,
          taxConfigVerified: true,
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const exceedsCap = count > BULK_TAX_CONFIG_MAX_PRODUCTS;
    return {
      success: true,
      message: exceedsCap
        ? `Filter matches ${count} products — exceeds per-call cap of ${BULK_TAX_CONFIG_MAX_PRODUCTS}. Narrow before submitting.`
        : `Filter matches ${count} product(s).`,
      data: {
        matchingCount: count,
        capExceeded: exceedsCap,
        cap: BULK_TAX_CONFIG_MAX_PRODUCTS,
        sample,
      },
    };
  }

  /**
   * Phase 45 (2026-05-21) — bulk attestation endpoint. Separate from
   * bulk-tax-config so attestation requires explicit action (admin
   * can't accidentally attest while editing data). Closes the prompt-
   * suggested split between data-change and attestation.
   */
  @Post('bulk/verify-tax-config')
  @HttpCode(HttpStatus.OK)
  // Phase 46 (2026-05-21) — dedicated perm key + role guard.
  @Permissions('tax.bulk-verify')
  @Roles('SUPER_ADMIN')
  @Idempotent()
  async bulkVerifyTaxConfig(
    @CurrentAdmin() adminId: string,
    @Body() dto: BulkVerifyTaxConfigDto,
  ) {
    const attestedIds: string[] = [];
    const failed: Array<{ productId: string; reason: string }> = [];
    for (const productId of dto.productIds) {
      try {
        await this.taxAttestation.attest({
          productId,
          actorId: adminId,
          actorRole: 'ADMIN',
          reviewerNote: dto.reviewerNote ?? null,
        });
        attestedIds.push(productId);
      } catch (err: any) {
        failed.push({ productId, reason: err?.message ?? 'unknown error' });
      }
    }
    this.logger.log(
      `Bulk verify-tax-config by admin ${adminId}: ok=${attestedIds.length} failed=${failed.length}`,
    );
    return {
      success: true,
      message: `Attested ${attestedIds.length} of ${dto.productIds.length}`,
      data: { attestedIds, failed },
    };
  }

  @Patch(':productId/verify-tax-config')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  async verifyTaxConfig(
    @CurrentAdmin() adminId: string,
    @Param('productId') productId: string,
    @Body() dto: VerifyTaxConfigDto,
  ) {
    // Phase 45 (2026-05-21) — delegates to ProductTaxAttestationService
    // which row-locks, re-validates the current tax columns, bumps
    // taxConfigVersion, and writes a TaxAttestationLog row. Pre-Phase-45
    // the controller wrote the columns directly and returned early
    // when already verified — leaving Gap #12 (no re-validation) +
    // Gap #6 (no audit chain) + Gap #8 (no optimistic lock) wide open.
    const result = await this.taxAttestation.attest({
      productId,
      actorId: adminId,
      actorRole: 'ADMIN',
      expectedVersion: dto.expectedVersion,
      reviewerNote: dto.reviewerNote ?? null,
    });
    this.logger.log(
      `Product ${productId} tax config verified by admin ${adminId} version=${result.taxConfigVersion}`,
    );
    return {
      success: true,
      message: 'Tax config verified',
      data: {
        taxConfigVerified: true,
        taxConfigVerifiedAt: result.taxConfigVerifiedAt,
        taxConfigVerifiedBy: result.taxConfigVerifiedBy,
        taxConfigVersion: result.taxConfigVersion,
      },
    };
  }

  /**
   * Phase 45 (2026-05-21) — read the per-product attestation audit
   * log. Used by the admin UI's tax-config panel to render the
   * history of attest / reset / edit transitions.
   */
  @Get(':productId/tax-attestation-log')
  @HttpCode(HttpStatus.OK)
  // Phase 46 (2026-05-21) — dedicated read key. Phase 45 reused
  // catalog.read which over-granted: any catalog-reader admin could
  // browse attestation history. The new tax.audit.read key narrows
  // the audience to finance / CA / SUPER_ADMIN.
  @Permissions('tax.audit.read')
  async getTaxAttestationLog(
    @Param('productId') productId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.taxAttestation.getAuditLog(productId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, message: 'Tax attestation log', data: entries };
  }

  @Patch(':productId/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  async rejectProduct(@CurrentAdmin() adminId: string, @Param('productId') productId: string, @Body() dto: AdminRejectProductDto) {
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    // Phase 31 (2026-05-21) — /reject is a moderation-time action,
    // not a live-product takedown. Pre-Phase-31 it accepted ACTIVE +
    // APPROVED, which let a single admin yank a live product from
    // the storefront in one click without going through the
    // /status SUSPENDED → ARCHIVED takedown path. Now narrowed to
    // states a product can legitimately be in DURING moderation.
    const rejectableStatuses = AdminProductsController.MODERATION_REVIEW_STATES;
    if (!rejectableStatuses.includes(product.status)) {
      throw new AppException(
        `Cannot reject a product with status ${product.status}. ` +
          `Use PATCH /admin/products/:id/status (target SUSPENDED or ARCHIVED) ` +
          `to take down a live product.`,
        'BAD_REQUEST',
      );
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
  @Permissions('catalog.approve')
  async requestChanges(@CurrentAdmin() adminId: string, @Param('productId') productId: string, @Body() dto: AdminRequestChangesDto) {
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    // Phase 31 (2026-05-21) — same scope narrowing as /reject above.
    const changeableStatuses = AdminProductsController.MODERATION_REVIEW_STATES;
    if (!changeableStatuses.includes(product.status)) {
      throw new AppException(
        `Cannot request changes on a product with status ${product.status}. ` +
          `Use PATCH /admin/products/:id/status (target SUSPENDED) for live products.`,
        'BAD_REQUEST',
      );
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
  @Permissions('catalog.approve')
  async updateStatus(@CurrentAdmin() adminId: string, @Param('productId') productId: string, @Body() dto: AdminUpdateProductStatusDto) {
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
  @Permissions('catalog.approve')
  async bulkApprove(
    @CurrentAdmin() adminId: string,
    @Body() dto: { productIds: string[] },
  ) {
    const ids = this.validateBulkIds(dto.productIds);

    const ok: string[] = [];
    const alreadyDone: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const productId of ids) {
      try {
        const product = await this.productRepo.findByIdBasic(productId);
        if (!product) {
          failed.push({ id: productId, reason: 'Product not found' });
          continue;
        }
        // Phase 31 (2026-05-21) — retry-safe classification. Items
        // already in the target state are reported as `alreadyDone`
        // instead of `failed`. Without this, a partial-failure batch
        // (server crashed mid-loop) couldn't be retried — half the
        // batch would surface as scary "wrong state" failures.
        if (product.status === 'ACTIVE' || product.status === 'APPROVED') {
          alreadyDone.push(productId);
          continue;
        }
        if (!AdminProductsController.MODERATION_REVIEW_STATES.includes(product.status)) {
          failed.push({
            id: productId,
            reason: `Cannot approve from status ${product.status}`,
          });
          continue;
        }
        // Phase 39 (2026-05-21) — same required-metafield gate as
        // single approve. We log the missing list per row instead
        // of failing the whole batch — a partial bulk-approve is
        // useful for admins clearing the queue.
        const mfCheck = await this.metafieldValidation.validateRequiredOnSubmit(
          productId,
          product.categoryId ?? null,
        );
        if (mfCheck.missing.length > 0) {
          failed.push({
            id: productId,
            reason: `Missing required metafields: ${mfCheck.missing
              .map((m) => m.name || m.key)
              .join(', ')}`,
          });
          continue;
        }
        await this.productRepo.approveInTransaction(
          productId,
          [
            { fromStatus: product.status, toStatus: 'APPROVED', changedBy: adminId, reason: 'Bulk approve' },
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
      `Bulk approve by admin ${adminId}: ok=${ok.length}, alreadyDone=${alreadyDone.length}, failed=${failed.length}`,
    );

    return {
      success: true,
      message: `Approved ${ok.length} of ${ids.length} (${alreadyDone.length} already approved, ${failed.length} failed)`,
      data: { ok, alreadyDone, failed },
    };
  }

  @Post('bulk/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  async bulkReject(
    @CurrentAdmin() adminId: string,
    @Body() dto: { productIds: string[]; reason: string },
  ) {
    const ids = this.validateBulkIds(dto.productIds);
    const reason = this.validateBulkReason(dto.reason, 'reason');

    const ok: string[] = [];
    const alreadyDone: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const productId of ids) {
      try {
        const product = await this.productRepo.findByIdBasic(productId);
        if (!product) {
          failed.push({ id: productId, reason: 'Product not found' });
          continue;
        }
        if (product.status === 'REJECTED') {
          alreadyDone.push(productId);
          continue;
        }
        if (!AdminProductsController.MODERATION_REVIEW_STATES.includes(product.status)) {
          failed.push({
            id: productId,
            reason: `Cannot reject from status ${product.status} — use PATCH /:id/status for takedown`,
          });
          continue;
        }
        await this.productRepo.rejectInTransaction(
          productId,
          reason,
          { fromStatus: product.status, toStatus: 'REJECTED', changedBy: adminId, reason },
          { moderatorId: adminId },
        );
        await this.eventBus
          .publish({
            eventName: 'catalog.listing.rejected',
            aggregate: 'Product',
            aggregateId: productId,
            occurredAt: new Date(),
            payload: { productId, productTitle: product.title, sellerId: product.sellerId, reason, adminId },
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
      `Bulk reject by admin ${adminId}: ok=${ok.length}, alreadyDone=${alreadyDone.length}, failed=${failed.length}`,
    );

    return {
      success: true,
      message: `Rejected ${ok.length} of ${ids.length} (${alreadyDone.length} already rejected, ${failed.length} failed)`,
      data: { ok, alreadyDone, failed },
    };
  }

  @Post('bulk/request-changes')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  async bulkRequestChanges(
    @CurrentAdmin() adminId: string,
    @Body() dto: { productIds: string[]; note: string },
  ) {
    const ids = this.validateBulkIds(dto.productIds);
    const note = this.validateBulkReason(dto.note, 'note');

    const ok: string[] = [];
    const alreadyDone: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const productId of ids) {
      try {
        const product = await this.productRepo.findByIdBasic(productId);
        if (!product) {
          failed.push({ id: productId, reason: 'Product not found' });
          continue;
        }
        if (product.status === 'CHANGES_REQUESTED') {
          alreadyDone.push(productId);
          continue;
        }
        if (!AdminProductsController.MODERATION_REVIEW_STATES.includes(product.status)) {
          failed.push({
            id: productId,
            reason: `Cannot request changes from status ${product.status} — use PATCH /:id/status for live products`,
          });
          continue;
        }
        await this.productRepo.requestChangesInTransaction(
          productId,
          note,
          { fromStatus: product.status, toStatus: 'CHANGES_REQUESTED', changedBy: adminId, reason: note },
          { moderatorId: adminId },
        );
        await this.eventBus
          .publish({
            eventName: 'catalog.listing.request_changes',
            aggregate: 'Product',
            aggregateId: productId,
            occurredAt: new Date(),
            payload: { productId, productTitle: product.title, sellerId: product.sellerId, note, adminId },
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
      `Bulk request-changes by admin ${adminId}: ok=${ok.length}, alreadyDone=${alreadyDone.length}, failed=${failed.length}`,
    );

    return {
      success: true,
      message: `Changes requested on ${ok.length} of ${ids.length} (${alreadyDone.length} already in CHANGES_REQUESTED, ${failed.length} failed)`,
      data: { ok, alreadyDone, failed },
    };
  }

  /**
   * Phase 249 (#4) — stamp AI-content provenance onto a product and
   * flip its AiGenerationLog row GENERATED → ACCEPTED. Mirrors the
   * seller controller's helper (an admin can also save a product that
   * kept an AI draft). Called with the product id once it's known
   * (after create, or from the route param on update) when the request
   * carried `aiGenerationLogId`.
   *
   * Best-effort: a bad / missing / already-resolved log id never fails
   * the product save. Uses `prisma.aiGenerationLog` directly (same DB)
   * rather than cross-module DI into the AI module.
   *
   *   • Product stamp — idempotent (always set when the log resolves).
   *   • Log flip — CAS on `status='GENERATED'` so a re-save doesn't
   *     clobber the first acceptance's productId / acceptedAt.
   */
  private async stampAiProvenance(
    productId: string,
    aiGenerationLogId: string | undefined,
  ): Promise<void> {
    if (!aiGenerationLogId) return;
    try {
      const log = await this.prisma.aiGenerationLog.findUnique({
        where: { id: aiGenerationLogId },
        select: { id: true, promptVersion: true },
      });
      if (!log) {
        this.logger.warn(
          `aiGenerationLogId ${aiGenerationLogId} not found — skipping AI provenance for product ${productId}`,
        );
        return;
      }

      await this.prisma.product.update({
        where: { id: productId },
        data: {
          aiGenerated: true,
          aiGeneratedAt: new Date(),
          aiPromptVersion: log.promptVersion,
        },
      });

      const res = await this.prisma.aiGenerationLog.updateMany({
        where: { id: aiGenerationLogId, status: 'GENERATED' },
        data: { status: 'ACCEPTED', productId, acceptedAt: new Date() },
      });
      if (res.count === 0) {
        this.logger.log(
          `AiGenerationLog ${aiGenerationLogId} was not in GENERATED state (already resolved) — product ${productId} stamped, log left as-is`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to stamp AI provenance for product ${productId} (log ${aiGenerationLogId}): ${err}`,
      );
    }
  }

  /**
   * Phase 31 (2026-05-21) — shared validators for the three bulk
   * endpoints. The pre-Phase-31 inline checks let unbounded batches
   * through; a batch of 10k took minutes per worker and held the
   * Postgres connection long enough to starve other requests. The
   * BULK_MAX_BATCH cap is intentionally low (200) — operators
   * needing larger batches should use the dedicated /bulk/tax-config
   * paths or wait for the async-job variant.
   *
   * The ids are also deduped here so a duplicate id within a batch
   * doesn't surface as a misleading "wrong state" on the second
   * occurrence after the first one approves.
   */
  private validateBulkIds(input: unknown): string[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new BadRequestAppException('productIds must be a non-empty array');
    }
    if (input.length > AdminProductsController.BULK_MAX_BATCH) {
      throw new BadRequestAppException(
        `Bulk batch size cannot exceed ${AdminProductsController.BULK_MAX_BATCH} products per request`,
      );
    }
    const unique = Array.from(
      new Set(input.filter((id): id is string => typeof id === 'string' && id.trim() !== '')),
    );
    if (unique.length === 0) {
      throw new BadRequestAppException('productIds must be a non-empty array of strings');
    }
    return unique;
  }

  private validateBulkReason(raw: unknown, field: 'reason' | 'note'): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new BadRequestAppException(`${field} is required`);
    }
    const trimmed = raw.trim();
    if (trimmed.length < 10) {
      throw new BadRequestAppException(`${field} must be at least 10 characters`);
    }
    if (trimmed.length > 2000) {
      throw new BadRequestAppException(`${field} must not exceed 2000 characters`);
    }
    return trimmed;
  }
}
