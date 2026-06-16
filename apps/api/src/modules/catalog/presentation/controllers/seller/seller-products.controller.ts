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
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import {
  NotFoundAppException,
  BadRequestAppException,
  ForbiddenAppException,
} from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { SellerAuthGuard } from '../../../../../core/guards';
import { Idempotent } from '../../../../../core/decorators/idempotent.decorator';
import { CurrentSeller } from '../../../../../core/decorators/current-actor.decorator';
import { ProductSlugService } from '../../../application/services/product-slug.service';
import { ProductCodeService } from '../../../application/services/product-code.service';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
// Phase 45 (2026-05-21) — write tax-attestation audit rows on
// seller-driven tax-field edits so the CA chain captures the RESET.
import { ProductTaxAttestationService } from '../../../application/services/product-tax-attestation.service';
// Phase 39 (2026-05-21) — required-metafield gate on submit-for-review.
import { MetafieldValidationService } from '../../../application/services/metafield-validation.service';
import { SellerCreateProductDto } from '../../dtos/seller-create-product.dto';
import { SellerUpdateProductDto } from '../../dtos/seller-update-product.dto';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../../domain/repositories/variant.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';
import type { SellerMetafieldValueDto } from '../../dtos/seller-create-product.dto';

@ApiTags('Seller Products')
@Controller('seller/products')
@UseGuards(SellerAuthGuard)
export class SellerProductsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
    private readonly logger: AppLoggerService,
    private readonly slugService: ProductSlugService,
    private readonly productCodeService: ProductCodeService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly reApprovalService: ReApprovalService,
    private readonly eventBus: EventBusService,
    private readonly metafieldValidation: MetafieldValidationService,
    private readonly taxAttestation: ProductTaxAttestationService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('SellerProductsController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Phase 32 (2026-05-21) — @Idempotent opts the create endpoint into
  // the existing X-Idempotency-Key flow. The audit's "no idempotency on
  // POST" claim was outdated — the interceptor + sweeper + decorator
  // had been in place since Phase 1; this endpoint just wasn't opted
  // in. Clients should send a UUID v4 in `X-Idempotency-Key` per intent
  // (e.g. one per "Save & Submit" click); a duplicate with the same
  // key replays the first response instead of creating a second product.
  @Idempotent()
  async createProduct(
    @CurrentSeller() sellerId: string,
    @Body() dto: SellerCreateProductDto,
  ) {

    // Block product creation for non-ACTIVE or email-unverified sellers
    const seller = await this.productRepo.findSellerById(sellerId);
    if (!seller || seller.status !== 'ACTIVE') {
      throw new ForbiddenAppException(
        'Your account must be approved before you can create products.',
      );
    }
    if (!seller.isEmailVerified) {
      throw new ForbiddenAppException(
        'Please verify your email before creating products.',
      );
    }

    // Phase 30 (2026-05-21) — admin-only field stripping moved into
    // SellerCreateProductDto's allowlist. categoryName / brandName /
    // procurementPrice are no longer accepted off the seller path.

    const slug = await this.slugService.generateUniqueSlug(dto.title);
    const productCode = await this.productCodeService.generateProductCode();

    // Tax-config (HSN / GST rate / supply taxability / cess / UQC / tax
    // category) is NOT set by sellers — it's super-admin-only and applied
    // later via the SUPER_ADMIN tax-config endpoints. The product is
    // created with the schema defaults for those columns.

    // Phase 30 (2026-05-21) — atomic create + optional submit. The
    // pre-Phase-30 flow required a separate POST .../submit call so a
    // network failure between the two created an orphan DRAFT the
    // admin queue never saw. When submitImmediately=true the controller
    // runs the readiness check + status flip + event emission as part
    // of the same request.
    const wantsSubmit = dto.submitImmediately === true;
    const initialStatus = 'DRAFT';

    const product = await this.productRepo.createInTransaction(
      {
        sellerId,
        productCode,
        title: dto.title,
        slug,
        shortDescription: dto.shortDescription,
        description: dto.description,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        hasVariants: dto.hasVariants,
        basePrice: dto.basePrice,
        compareAtPrice: dto.compareAtPrice,
        costPrice: dto.costPrice,
        baseSku: dto.baseSku,
        baseStock: dto.baseStock,
        baseBarcode: dto.baseBarcode,
        weight: dto.weight,
        weightUnit: dto.weightUnit,
        length: dto.length,
        width: dto.width,
        height: dto.height,
        dimensionUnit: dto.dimensionUnit,
        returnPolicy: dto.returnPolicy,
        warrantyInfo: dto.warrantyInfo,
      },
      dto.tags,
      dto.seo,
      dto.variants,
      {
        fromStatus: null,
        toStatus: initialStatus,
        changedBy: sellerId,
        reason: 'Product created',
      },
    );

    this.logger.log(`Product created: ${product.id} by seller ${sellerId}`);

    // Phase 249 (#4) — stamp AI provenance + flip the log to ACCEPTED
    // now that the product row exists (so we have its id). Best-effort:
    // never blocks the create response.
    await this.stampAiProvenance(product.id, dto.aiGenerationLogId);

    // ── Phase 11 / T3: Auto-create SellerProductMapping for the creator ──
    try {
      const sellerProfile = await this.productRepo.findSellerById(sellerId);

      if (product.hasVariants) {
        const createdVariants = await this.variantRepo.findByProductId(product.id);

        if (createdVariants.length > 0) {
          for (const variant of createdVariants) {
            await this.sellerMappingRepo.create({
              sellerId,
              productId: product.id,
              variantId: variant.id,
              stockQty: variant.stock ?? 0,
              settlementPrice: variant.price ? Number(variant.price) : (product.basePrice ? Number(product.basePrice) : undefined),
              pickupAddress: sellerProfile?.storeAddress || null,
              pickupPincode: sellerProfile?.sellerZipCode || null,
              dispatchSla: 2,
              approvalStatus: 'PENDING_APPROVAL',
              isActive: false,
            });
          }
          this.logger.log(
            `Auto-created ${createdVariants.length} seller mapping(s) for variant product ${product.id} (pending approval)`,
          );
        }
      } else {
        await this.sellerMappingRepo.create({
          sellerId,
          productId: product.id,
          variantId: null,
          stockQty: product.baseStock ?? 0,
          settlementPrice: product.basePrice ? Number(product.basePrice) : undefined,
          pickupAddress: sellerProfile?.storeAddress || null,
          pickupPincode: sellerProfile?.sellerZipCode || null,
          dispatchSla: 2,
          approvalStatus: 'PENDING_APPROVAL',
          isActive: false,
        });
        this.logger.log(
          `Auto-created seller mapping for simple product ${product.id} (pending approval)`,
        );
      }
    } catch (mappingError) {
      this.logger.warn(
        `Failed to auto-create seller mapping for product ${product.id}: ${mappingError}`,
      );
    }

    // Phase 39 (2026-05-21) — apply seller-supplied metafields right
    // after the row exists. Runs before the wantsSubmit branch so the
    // required-metafield gate sees the values the seller is about to
    // post in this same call (otherwise atomic create+submit with
    // metafields[] would always fail the gate).
    if (dto.metafields && dto.metafields.length > 0) {
      await this.applySellerMetafields(product.id, product.categoryId ?? null, dto.metafields);
    }

    // Phase 30 (2026-05-21) — atomic submit branch. Runs the same
    // readiness check as the standalone /submit endpoint then flips
    // the row to SUBMITTED / PENDING + emits the QC event. We re-fetch
    // the product with full relations so the validation sees images +
    // variants. A readiness failure throws BadRequestAppException —
    // the seller sees the field list and the row stays DRAFT (still
    // editable). The seller mapping created above stays PENDING_APPROVAL
    // regardless, so this is purely about getting the row into the
    // admin queue atomically.
    if (wantsSubmit) {
      const readinessProduct = await this.productRepo.findFullProduct(product.id);
      if (readinessProduct) {
        this.assertReadyForReview(readinessProduct);
        // Phase 39 (2026-05-21) — required category metafields gate.
        // Walks the category hierarchy, throws a 400 listing every
        // missing required definition. Runs after the cheaper field
        // checks so we don't issue DB calls for products that fail
        // earlier validations.
        const mfCheck = await this.metafieldValidation.validateRequiredOnSubmit(
          product.id,
          readinessProduct.categoryId ?? null,
        );
        if (mfCheck.missing.length > 0) {
          throw new BadRequestAppException(
            `Cannot submit for review — missing required metafields: ${mfCheck.missing
              .map((m) => m.name || m.key)
              .join(', ')}`,
          );
        }
        await this.productRepo.submitForReviewInTransaction(
          product.id,
          { status: 'SUBMITTED', moderationStatus: 'PENDING' },
          {
            fromStatus: initialStatus,
            toStatus: 'SUBMITTED',
            changedBy: sellerId,
            reason: 'Submitted for review (atomic create + submit)',
          },
        );
        try {
          await this.eventBus.publish({
            eventName: 'catalog.listing.submitted_for_qc',
            aggregate: 'Product',
            aggregateId: product.id,
            occurredAt: new Date(),
            payload: {
              productId: product.id,
              productTitle: product.title,
              sellerId,
            },
          });
        } catch (err) {
          this.logger.warn(
            `Failed to emit catalog.listing.submitted_for_qc event: ${err}`,
          );
        }
      }
    }

    // Fetch full product
    const fullProduct = await this.productRepo.findFullProduct(product.id);

    return {
      success: true,
      message: wantsSubmit
        ? 'Product created and submitted for review.'
        : 'Product created as draft. Use POST /seller/products/:id/submit to send it for review.',
      data: fullProduct,
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listProducts(
    @CurrentSeller() sellerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '10', 10) || 10));

    const { products, total } = await this.productRepo.findBySellerPaginated({
      sellerId,
      page: pageNum,
      limit: limitNum,
      status,
      search,
      categoryId,
    });

    const mapped = products.map((p: any) => {
      const totalVariantStock = p.variants?.reduce((sum: number, v: any) => sum + (v.stock || 0), 0) ?? 0;
      return {
        ...p,
        variantCount: p._count?.variants ?? 0,
        totalStock: p.hasVariants ? totalVariantStock : (p.baseStock ?? 0),
        primaryImageUrl: p.images?.[0]?.url ?? null,
        categoryName: p.category?.name ?? null,
        brandName: p.brand?.name ?? null,
        _count: undefined,
        images: undefined,
        variants: undefined,
      };
    });

    return {
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':productId')
  @HttpCode(HttpStatus.OK)
  async getProduct(@CurrentSeller() sellerId: string, @Param('productId') productId: string) {
    const product = await this.productRepo.findByIdForSeller(productId, sellerId);

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    return {
      success: true,
      message: 'Product retrieved successfully',
      data: product,
    };
  }

  @Patch(':productId')
  @HttpCode(HttpStatus.OK)
  async updateProduct(
    @CurrentSeller() sellerId: string,
    @Param('productId') productId: string,
    @Body() dto: SellerUpdateProductDto,
  ) {
    // Validate ownership
    await this.ownershipService.validateOwnership(sellerId, productId);

    // A suspended/deactivated seller must not keep mutating their catalog
    // (mirrors the create gate + the self-status-resume re-check). Checked
    // after ownership so a non-owner doesn't learn anything about the account.
    const sellerAccount = await this.productRepo.findSellerById(sellerId);
    if (!sellerAccount || sellerAccount.status !== 'ACTIVE') {
      throw new ForbiddenAppException('Your account must be active to edit products.');
    }

    // Phase 249 (#4) — stamp AI provenance + flip the log to ACCEPTED.
    // Done up front (independent of the field-diff below) so it still
    // records even when this PATCH changes nothing else — e.g. the
    // seller re-saves a draft that kept the AI copy. CAS on the log
    // makes a repeat save a no-op on the log row. Best-effort.
    await this.stampAiProvenance(productId, dto.aiGenerationLogId);

    // Phase 30 (2026-05-21) — admin-only field stripping removed; the
    // seller DTO no longer accepts procurementPrice / categoryName /
    // brandName via its allowlist.

    // Fetch current product to compare values — only include fields that actually changed
    const current = await this.productRepo.findByIdBasic(productId);
    if (current && current.status === 'ARCHIVED') {
      throw new BadRequestAppException('Cannot edit an archived product.');
    }

    const updateData: any = {};
    if (dto.title !== undefined && dto.title !== current?.title) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    if (dto.categoryId !== undefined && dto.categoryId !== current?.categoryId) {
      updateData.categoryId = dto.categoryId;
    }
    if (dto.brandId !== undefined && dto.brandId !== current?.brandId) {
      updateData.brandId = dto.brandId;
    }

    const simpleFields: Array<{ key: string; dtoKey: keyof typeof dto }> = [
      { key: 'shortDescription', dtoKey: 'shortDescription' },
      { key: 'description', dtoKey: 'description' },
      { key: 'hasVariants', dtoKey: 'hasVariants' },
      { key: 'basePrice', dtoKey: 'basePrice' },
      { key: 'compareAtPrice', dtoKey: 'compareAtPrice' },
      { key: 'costPrice', dtoKey: 'costPrice' },
      { key: 'baseSku', dtoKey: 'baseSku' },
      { key: 'baseStock', dtoKey: 'baseStock' },
      { key: 'baseBarcode', dtoKey: 'baseBarcode' },
      { key: 'weight', dtoKey: 'weight' },
      { key: 'weightUnit', dtoKey: 'weightUnit' },
      { key: 'length', dtoKey: 'length' },
      { key: 'width', dtoKey: 'width' },
      { key: 'height', dtoKey: 'height' },
      { key: 'dimensionUnit', dtoKey: 'dimensionUnit' },
      { key: 'returnPolicy', dtoKey: 'returnPolicy' },
      { key: 'warrantyInfo', dtoKey: 'warrantyInfo' },
      // Tax columns (HSN, GST rate, supply taxability, cess, UQC, tax
      // category) are intentionally NOT on the seller allowlist — they are
      // super-admin-only and set via the SUPER_ADMIN tax-config endpoints.
    ];
    for (const { key, dtoKey } of simpleFields) {
      const dtoVal = dto[dtoKey];
      if (dtoVal !== undefined) {
        // Compare with type coercion for Decimal fields
        const curVal = (current as Record<string, unknown> | null)?.[key];
        const dtoStr = String(dtoVal ?? '');
        const curStr = String(curVal ?? '');
        if (dtoStr !== curStr) {
          updateData[key] = dtoVal;
        }
      }
    }

    // Tax-config columns are not seller-editable (removed from the
    // allowlist above), so no tax-attestation reset / audit handling runs
    // on a seller update. Tax changes happen only through the SUPER_ADMIN
    // tax-config endpoints.

    // Compare tags — only include if actually different
    let tagsChanged = false;
    if (dto.tags !== undefined && current) {
      const currentProduct = await this.productRepo.findFullProduct(productId);
      const currentTags = (currentProduct?.tags || []).map((t: any) => t.tag || t).sort();
      const newTags = [...dto.tags].sort();
      tagsChanged = JSON.stringify(currentTags) !== JSON.stringify(newTags);
    }

    // Compare SEO — only include if actually different
    let seoChanged = false;
    if (dto.seo !== undefined && current) {
      const currentProduct = await this.productRepo.findFullProduct(productId);
      const curSeo = currentProduct?.seo;
      if (curSeo) {
        seoChanged = (dto.seo.metaTitle !== curSeo.metaTitle) ||
          (dto.seo.metaDescription !== curSeo.metaDescription) ||
          (dto.seo.metaKeywords !== curSeo.metaKeywords);
      } else {
        seoChanged = !!(dto.seo.metaTitle || dto.seo.metaDescription || dto.seo.metaKeywords);
      }
    }

    // Phase 39 (2026-05-21) — metafield-only update is a valid no-op for
    // the product columns; we apply the metafields, mark the request as
    // touching content (for re-approval), then return without triggering
    // a product-table write.
    const hasMetafieldChanges = !!(dto.metafields && dto.metafields.length > 0);

    // If nothing actually changed, return early without triggering re-approval
    if (Object.keys(updateData).length === 0 && !tagsChanged && !seoChanged && !hasMetafieldChanges) {
      const fullProduct = await this.productRepo.findFullProduct(productId);
      return {
        success: true,
        message: 'No changes detected',
        data: fullProduct,
      };
    }

    const product = await this.productRepo.updateInTransaction(
      productId,
      updateData,
      tagsChanged ? dto.tags : undefined,
      seoChanged ? dto.seo : undefined,
    );

    // Phase 39 — apply metafield updates after the product row write so
    // a category change in the same call has already landed. The
    // metafield helper validates each entry against its definition;
    // it throws BadRequestAppException on a failure, which leaves the
    // product write committed but the metafield set partial — that
    // matches the create path's behaviour.
    if (hasMetafieldChanges) {
      const effectiveCategoryId = updateData.categoryId ?? current?.categoryId ?? null;
      await this.applySellerMetafields(productId, effectiveCategoryId, dto.metafields);
    }

    // Trigger re-approval only if content fields actually changed. The
    // classifier treats price / inventory / physical / policy fields as
    // self-serve (stay LIVE); anything else forces a fresh admin review.
    // Tags + SEO always count as content when present.
    const changedFields = Object.keys(updateData).filter((k) => k !== 'slug');
    if (tagsChanged) changedFields.push('tags');
    if (seoChanged) changedFields.push('seo');
    // Phase 39 — metafield changes are content; force a re-approval pass.
    if (hasMetafieldChanges) changedFields.push('metafields');
    const reApproved = await this.reApprovalService.triggerIfNeeded(
      productId,
      sellerId,
      { changedFields },
    );

    // Fetch full product
    const fullProduct = await this.productRepo.findFullProduct(product.id);

    return {
      success: true,
      message: reApproved
        ? 'Product updated — sent for re-approval'
        : 'Product updated successfully',
      data: fullProduct,
    };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async deleteProduct(
    @CurrentSeller() sellerId: string,
    @Param('productId') productId: string,
  ) {
    await this.ownershipService.validateOwnership(sellerId, productId);

    const existing = await this.productRepo.findByIdBasic(productId);

    const deletableStatuses = ['DRAFT', 'REJECTED'];
    if (!deletableStatuses.includes(existing!.status)) {
      throw new AppException(
        'Product can only be deleted when in DRAFT or REJECTED status',
        'BAD_REQUEST',
      );
    }

    await this.productRepo.softDelete(productId);

    return {
      success: true,
      message: 'Product deleted successfully',
      data: null,
    };
  }

  // 2026-06-15 — the product-level self-status pause/resume endpoint was REMOVED.
  // It set Product.status=SUSPENDED, which hid the shared catalog product from
  // ALL sellers — a seller must not be able to stop everyone's sales. Per-seller
  // pausing now lives at POST /seller/catalog/product/:id/pause-sales (+ resume),
  // which touches only this seller's own mappings.

  @Post(':productId/submit')
  @HttpCode(HttpStatus.OK)
  async submitForReview(
    @CurrentSeller() sellerId: string,
    @Param('productId') productId: string,
  ) {
    await this.ownershipService.validateOwnership(sellerId, productId);

    const product = await this.productRepo.findByIdForSeller(productId, sellerId);

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    const submittableStatuses = ['DRAFT', 'REJECTED', 'CHANGES_REQUESTED'];
    if (!submittableStatuses.includes(product.status)) {
      throw new AppException(
        'Only DRAFT, REJECTED, or CHANGES_REQUESTED products can be submitted for review',
        'BAD_REQUEST',
      );
    }

    this.assertReadyForReview(product);

    // Phase 39 (2026-05-21) — required category metafield gate. We
    // run this after assertReadyForReview so a product missing a
    // brand / category / image gets the cheaper message first
    // instead of a "missing metafields" 400 they can't act on.
    const mfCheck = await this.metafieldValidation.validateRequiredOnSubmit(
      productId,
      product.categoryId ?? null,
    );
    if (mfCheck.missing.length > 0) {
      throw new BadRequestAppException(
        `Cannot submit for review — missing required metafields: ${mfCheck.missing
          .map((m) => m.name || m.key)
          .join(', ')}`,
      );
    }

    await this.productRepo.submitForReviewInTransaction(
      productId,
      {
        status: 'SUBMITTED',
        moderationStatus: 'PENDING',
      },
      {
        fromStatus: product.status,
        toStatus: 'SUBMITTED',
        changedBy: sellerId,
        reason: 'Submitted for review',
      },
    );

    // Emit event for admin notification
    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.submitted_for_qc',
        aggregate: 'Product',
        aggregateId: productId,
        occurredAt: new Date(),
        payload: {
          productId,
          productTitle: product.title,
          sellerId,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.submitted_for_qc event: ${err}`);
    }

    return {
      success: true,
      message: 'Product submitted for review',
      data: {
        product: { id: productId },
      },
    };
  }

  /**
   * Phase 30 (2026-05-21) — shared readiness gate for the standalone
   * `/submit` endpoint and the atomic create+submit path. Collects
   * every missing requirement up front and throws a single
   * BadRequestAppException listing all of them so the seller doesn't
   * have to fix one error, re-submit, fix the next, re-submit, ad
   * infinitum.
   *
   * Mirrors the Phase 29 publish-readiness check in
   * `approveInTransaction` so a product that passes here will not be
   * bounced back by the admin /approve endpoint. The admin check
   * additionally enforces required category metafields + taxConfigVerified,
   * which sellers cannot self-satisfy — those stay admin-only.
   */
  private assertReadyForReview(product: {
    title?: string | null;
    categoryId?: string | null;
    brandId?: string | null;
    basePrice?: unknown;
    weight?: unknown;
    hsnCode?: string | null;
    gstRateBps?: number | null;
    supplyTaxability?: string | null;
    hasVariants: boolean;
    images: Array<{ id: string }>;
    variants: Array<{ price: unknown; images: Array<{ id: string }> }>;
  }): void {
    const missing: string[] = [];

    if (!product.title?.trim()) missing.push('title');
    if (!product.categoryId) missing.push('categoryId');
    if (!product.brandId) missing.push('brandId');

    const hasProductImages = product.images.length > 0;
    const hasVariantImages =
      product.hasVariants &&
      product.variants.some((v) => v.images.length > 0);
    if (!hasProductImages && !hasVariantImages) {
      missing.push('at least 1 image');
    }

    if (product.hasVariants) {
      if (product.variants.length === 0) {
        missing.push('at least 1 variant');
      } else if (
        !product.variants.some(
          (v) => v.price !== null && v.price !== undefined && Number(v.price) > 0,
        )
      ) {
        missing.push('at least 1 variant with a price');
      }
    } else {
      if (product.basePrice == null || Number(product.basePrice) <= 0) {
        missing.push('basePrice');
      }
    }

    // Shipping weight — required for rate-card lookup at checkout.
    if (product.weight == null || Number(product.weight) <= 0) {
      missing.push('weight');
    }

    // Tax data (HSN + GST rate) is NO LONGER checked at seller submit:
    // sellers can't set it (it's super-admin-only), so blocking their
    // submission on it would be a dead end. A super-admin sets the
    // tax-config via the SUPER_ADMIN tax-config endpoints; until then the
    // tax snapshot flags the line INCOMPLETE for review.

    if (missing.length > 0) {
      throw new BadRequestAppException(
        `Cannot submit for review — missing: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Phase 249 (#4) — stamp AI-content provenance onto a freshly
   * created / updated product and flip its AiGenerationLog row
   * GENERATED → ACCEPTED. Called once the product id is known (after
   * create, or from the route param on update) when the request carried
   * `aiGenerationLogId`.
   *
   * Best-effort by design: a bad / missing / already-resolved log id
   * must never fail the product save (the product row is the source of
   * truth; provenance is a mirror). Talks to `prisma.aiGenerationLog`
   * directly rather than importing the AI module — both live in the
   * same database and the catalog controller already has PrismaService.
   *
   * Idempotency:
   *   • Product stamp — re-stamping aiGenerated=true is harmless, so we
   *     always stamp when the log resolves to a real row.
   *   • Log flip — CAS on `status='GENERATED'` (updateMany) so a re-save
   *     of the same draft does NOT clobber the first acceptance's
   *     productId / acceptedAt.
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

      // Stamp the product's provenance columns. aiHumanReviewed stays
      // at its default false — a human-review queue can flip it later.
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          aiGenerated: true,
          aiGeneratedAt: new Date(),
          aiPromptVersion: log.promptVersion,
        },
      });

      // CAS flip: only GENERATED → ACCEPTED. A second save (log already
      // ACCEPTED / DISCARDED) updates 0 rows and leaves the original
      // acceptance intact.
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
   * Phase 39 (2026-05-21) — write the seller-supplied metafields for a
   * product. Validates each entry against its definition (type + min /
   * max / regex / choice membership) then upserts. Re-uses the
   * existing ProductMetafield upsert path; this just wraps the
   * resolution (definitionId OR namespace+key) + validation.
   *
   * Throws BadRequestAppException with the aggregated error list so
   * the seller sees every problem in one round-trip, not one at a time.
   */
  private async applySellerMetafields(
    productId: string,
    categoryId: string | null,
    entries: SellerMetafieldValueDto[] | undefined,
  ): Promise<void> {
    if (!entries || entries.length === 0) return;

    const errors: string[] = [];
    const resolved: Array<{ definitionId: string; valueData: Record<string, unknown> }> = [];

    for (const entry of entries) {
      let definition: any = null;
      if (entry.definitionId) {
        definition = await this.metafieldRepo.findDefinitionById(entry.definitionId);
      } else if (entry.namespace && entry.key) {
        definition = await this.metafieldRepo.findDefinitionByNamespaceKey(
          entry.namespace,
          entry.key,
          categoryId,
        );
      }
      if (!definition) {
        errors.push(`Metafield not found: ${entry.namespace || ''}.${entry.key || entry.definitionId || ''}`);
        continue;
      }
      if (!definition.isActive) {
        errors.push(`${definition.name}: definition is inactive`);
        continue;
      }

      // Phase 39 — runtime validation. Delegates per-type checks to
      // MetafieldValidationService which is also wired into the
      // admin-product-metafields path.
      const check = this.metafieldValidation.validateValue(definition, entry.value);
      if (!check.ok) {
        errors.push(...check.errors);
        continue;
      }

      // Map the value to the right column based on type. Mirrors the
      // admin-product-metafields upsert mapping.
      const valueData: Record<string, unknown> = {};
      if (entry.value === null || entry.value === undefined || entry.value === '') {
        // empty → unset all value columns (acts as a delete-value)
        valueData.valueText = null;
        valueData.valueNumber = null;
        valueData.valueBoolean = null;
        valueData.valueDate = null;
        valueData.valueJson = null;
      } else {
        switch (definition.type) {
          case 'SINGLE_LINE_TEXT':
          case 'MULTI_LINE_TEXT':
          case 'URL':
          case 'COLOR':
          case 'FILE_REFERENCE':
          case 'SINGLE_SELECT':
            valueData.valueText = String(entry.value);
            break;
          case 'NUMBER_INTEGER':
          case 'NUMBER_DECIMAL':
          case 'RATING':
            valueData.valueNumber = Number(entry.value);
            break;
          case 'BOOLEAN':
            valueData.valueBoolean = entry.value === true || entry.value === 'true';
            break;
          case 'DATE':
            valueData.valueDate = new Date(entry.value as string | number);
            break;
          case 'MULTI_SELECT':
          case 'DIMENSION':
          case 'WEIGHT':
          case 'VOLUME':
          case 'JSON':
            valueData.valueJson = typeof entry.value === 'string'
              ? JSON.parse(entry.value)
              : entry.value;
            break;
        }
      }
      resolved.push({ definitionId: definition.id, valueData });
    }

    if (errors.length > 0) {
      throw new BadRequestAppException(
        `Metafield validation failed: ${errors.join('; ')}`,
      );
    }

    for (const { definitionId, valueData } of resolved) {
      await this.metafieldRepo.upsertProductMetafield(productId, definitionId, valueData);
    }
  }
}
